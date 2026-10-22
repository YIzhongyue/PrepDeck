// Question import pipeline shared by the REST admin import routes
// (routes/imports.ts) and Admin MCP's import tools
// (mcp/adapters/admin/imports.ts): validate the file, classify every row
// against what is already stored, plan each create/update as one atomic unit
// of statements, commit those in bounded batches, then archive the source
// file in R2 and log it in import_logs.
//
// Each entry point keeps its own concerns and plugs them in here: REST its
// body parsing, HTTP responses and question_mutation_audit_log rows; MCP its
// proposal tokens, atomic importId claims, committed-item ledger and
// admin_mcp_audit_log rows (see lib/importExecution.ts). Where the two paths
// still behave differently (batch size, outcome order, when the archive is
// written), the difference lives at the call site, not in here.
import { normalizeImportFile, validateImportFile, type ImportFileValidationResult, type QuestionImportFile } from "@prepdeck/shared";
import type { Env } from "../bindings";
import { canonical, createStatement, questionSelectColumns, toQuestion, updateStatement, type QuestionPayload, type QuestionRow } from "./questionManagement";
import { importConflict, type ImportConflict } from "./importConflicts";
import { buildTagLinkStatements, buildTagNameResolver, fetchTagIdsForQuestions } from "./questionBankTags";

const D1_LOOKUP_IDS_PER_QUERY = 90;
const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ARCHIVES_PER_EXAM = 20;

// --- Rate limiting --------------------------------------------------------------

// Consumes one unit of the native per-(user, exam) import limiter. A limiter
// that itself fails rejects here; callers decide what that means (REST lets
// it surface as a 500, MCP maps it to `unavailable`).
export async function limitImportRequest(
  env: Pick<Env, "IMPORT_VALIDATE_RATE_LIMITER" | "IMPORT_EXECUTE_RATE_LIMITER">,
  kind: "validate" | "execute", userId: string, examId: string,
): Promise<boolean> {
  const limiter = kind === "validate" ? env.IMPORT_VALIDATE_RATE_LIMITER : env.IMPORT_EXECUTE_RATE_LIMITER;
  return (await limiter.limit({ key: `${userId}:${examId}` })).success;
}

// --- Validation and lookup ------------------------------------------------------

// `file` is the normalized import file, present only when there are no issues.
export interface ImportValidation extends ImportFileValidationResult {
  file: QuestionImportFile | null;
}

export function validateImport(data: unknown): ImportValidation {
  const result = validateImportFile(data);
  return { ...result, file: result.issues.length === 0 ? normalizeImportFile(data) : null };
}

export function importTagNames(questions: readonly { tags?: string[] }[]): string[] {
  return questions.flatMap((q) => q.tags ?? []);
}

export async function findQuestionRows(db: D1Database, examId: string, externalIds: string[]): Promise<QuestionRow[]> {
  const rows: QuestionRow[] = [];
  for (let start = 0; start < externalIds.length; start += D1_LOOKUP_IDS_PER_QUERY) {
    const ids = externalIds.slice(start, start + D1_LOOKUP_IDS_PER_QUERY);
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT ${questionSelectColumns()} FROM questions WHERE exam_id = ? AND external_id IN (${placeholders})`
    ).bind(examId, ...ids).all<QuestionRow>();
    rows.push(...(results ?? []));
  }
  return rows;
}

// Every stored question an import row could match by externalId.
export async function findImportTargets(db: D1Database, examId: string, questions: QuestionPayload[]): Promise<QuestionRow[]> {
  const externalIds = questions.map((q) => q.externalId).filter((x): x is string => !!x);
  return externalIds.length ? findQuestionRows(db, examId, externalIds) : [];
}

// --- Row classification ---------------------------------------------------------

// What one file row means against current state. A row whose externalId
// matches several stored questions yields one `changed` decision per match,
// all `ambiguous`. A `changed` decision carries the full conflict (reason and
// field differences) whether or not it is safe to apply.
export interface CreateImportRow { kind: "create"; index: number; question: QuestionPayload; externalId: string | null }
export interface IdenticalImportRow { kind: "identical"; index: number; question: QuestionPayload; row: QuestionRow }
export interface ChangedImportRow {
  kind: "changed"; index: number; question: QuestionPayload; row: QuestionRow; conflict: ImportConflict; ambiguous: boolean;
}
export type ImportRowDecision = CreateImportRow | IdenticalImportRow | ChangedImportRow;

// In file order. This is a classification against the database as it stood
// when `existing` was read, not a guarantee: execute re-runs it at commit
// time, and a row edited in between moves from a clean update to a conflict.
export async function decideImportRows(
  db: D1Database, existing: QuestionRow[], questions: QuestionPayload[],
): Promise<ImportRowDecision[]> {
  const decisions: ImportRowDecision[] = [];
  for (const [index, question] of questions.entries()) {
    const matches = question.externalId ? existing.filter((r) => r.external_id === question.externalId) : [];
    if (!matches.length) {
      decisions.push({ kind: "create", index, question, externalId: question.externalId ?? null });
      continue;
    }
    const ambiguous = matches.length > 1;
    for (const row of matches) {
      if (!ambiguous && canonical(toQuestion(row)) === canonical(question)) {
        decisions.push({ kind: "identical", index, question, row });
        continue;
      }
      decisions.push({ kind: "changed", index, question, row, conflict: await importConflict(db, row, question, ambiguous), ambiguous });
    }
  }
  return decisions;
}

// A change to a question nobody has touched since its last import. Every
// other `changed` row (ambiguous, unknown provenance, locally edited) is a
// conflict in preview. Execute still requires a matching resolution for both.
export function isCleanUpdate(decision: ChangedImportRow): boolean {
  return !decision.ambiguous && decision.conflict.reason === "incoming_changes";
}

// The conflicts REST's /validate lists: every row that differs from what is
// stored, clean updates included.
export function changedRowConflicts(decisions: ImportRowDecision[]): ImportConflict[] {
  return decisions.filter((d): d is ChangedImportRow => d.kind === "changed").map((d) => d.conflict);
}

export interface ImportCreateCandidate { index: number; externalId: string | null }
export interface ImportUpdateCandidate {
  index: number; questionId: string; externalId: string | null; expectedRevision: number; incomingToken: string;
}
export interface ImportSkipCandidate { index: number; questionId: string; externalId: string | null; reason: string }
export interface ImportRowClassification {
  creates: ImportCreateCandidate[];
  updates: ImportUpdateCandidate[];
  skips: ImportSkipCandidate[];
  conflicts: (ImportConflict & { index: number })[];
}

// The create/update/skip/conflict breakdown admin_preview_import reports.
export function classifyImportDecisions(decisions: ImportRowDecision[]): ImportRowClassification {
  const classification: ImportRowClassification = { creates: [], updates: [], skips: [], conflicts: [] };
  for (const d of decisions) {
    if (d.kind === "create") classification.creates.push({ index: d.index, externalId: d.externalId });
    else if (d.kind === "identical") {
      classification.skips.push({ index: d.index, questionId: d.row.id, externalId: d.row.external_id, reason: "identical" });
    } else if (isCleanUpdate(d)) {
      classification.updates.push({
        index: d.index, questionId: d.row.id, externalId: d.row.external_id,
        expectedRevision: d.row.revision, incomingToken: d.conflict.incomingToken,
      });
    } else classification.conflicts.push({ ...d.conflict, index: d.index });
  }
  return classification;
}

// --- Conflict resolutions -------------------------------------------------------

// A reviewer's decision about one previewed differing row. It is scoped to the
// exact question, revision and incoming content it was made for: anything
// else about the row changing makes it not apply.
export interface ImportConflictResolution {
  questionId: string;
  expectedRevision: number;
  incomingToken: string;
  action: "keep" | "apply";
}

export function resolutionMatches(resolution: ImportConflictResolution, decision: ChangedImportRow): boolean {
  return resolution.questionId === decision.row.id
    && resolution.expectedRevision === decision.row.revision
    && resolution.incomingToken === decision.conflict.incomingToken;
}

// --- Write planning -------------------------------------------------------------

export interface ImportWrite {
  kind: "create" | "update";
  index: number;
  examId: string;
  questionId: string;
  externalId: string | null;
}

// `statements[0]` is the row write. The caller's chained statements follow
// it immediately (they may read its changes()), then the row's tag links, so
// the row and its links commit or roll back together.
export interface PlannedImportWrite { write: ImportWrite; statements: D1PreparedStatement[] }

// A row the import leaves as it is: identical, kept by its resolution, or a
// conflict (reason is the conflict's own) that needs a matching resolution.
export interface UnchangedImportRow {
  decision: IdenticalImportRow | ChangedImportRow;
  status: "skipped" | "conflict";
  reason: string;
}

export interface ImportPlan { writes: PlannedImportWrite[]; unchanged: UnchangedImportRow[] }

export interface ImportPlanInput {
  examId: string;
  // The whole file: every tag name in it is resolved (and created if new),
  // even for rows `decisions` leaves out.
  questions: QuestionPayload[];
  // The rows to plan, in the order the caller wants writes and unchanged
  // rows reported.
  decisions: ImportRowDecision[];
  now: string;
  // The caller's lookup for a changed row's resolution. Only one that
  // resolutionMatches the row is acted on.
  resolutionFor(decision: ChangedImportRow): ImportConflictResolution | undefined;
  // Statements that must sit directly after the row write, such as an audit
  // row or ledger entry conditional on its changes().
  chainedStatements(write: ImportWrite): D1PreparedStatement[];
  // MCP may journal a tag it actually creates in the same atomic batch.
  tagCreatedStatement?: (tagId: string, normalizedName: string) => D1PreparedStatement;
}

export async function planImportWrites(db: D1Database, input: ImportPlanInput): Promise<ImportPlan> {
  const { examId, now } = input;
  // Bulk-resolve every distinct tag name in the file once, rather than once
  // per created/updated row.
  const resolveTagIds = await buildTagNameResolver(db, importTagNames(input.questions), now, input.tagCreatedStatement);
  const unchanged: UnchangedImportRow[] = [];
  const toWrite: (CreateImportRow | ChangedImportRow)[] = [];
  for (const d of input.decisions) {
    if (d.kind === "create") toWrite.push(d);
    else if (d.kind === "identical") unchanged.push({ decision: d, status: "skipped", reason: "identical" });
    else {
      // Ambiguous external ids are never resolvable at all.
      const resolution = d.ambiguous ? undefined : input.resolutionFor(d);
      if (!resolution || !resolutionMatches(resolution, d)) unchanged.push({ decision: d, status: "conflict", reason: d.conflict.reason });
      else if (resolution.action === "keep") unchanged.push({ decision: d, status: "skipped", reason: "kept_current" });
      else toWrite.push(d);
    }
  }

  const updatedIds = toWrite.flatMap((d) => d.kind === "changed" ? [d.row.id] : []);
  const currentTagIdsByQuestion = await fetchTagIdsForQuestions(db, updatedIds);
  const writes = toWrite.map((d): PlannedImportWrite => {
    const tagIds = resolveTagIds(d.question.tags);
    if (d.kind === "create") {
      const write: ImportWrite = { kind: "create", index: d.index, examId, questionId: crypto.randomUUID(), externalId: d.externalId };
      // imported=true records import_baseline_json and the resolved tag ids
      // beside it, so a later re-import of this externalId can tell "locally
      // edited since" from "safe incoming change" (lib/importConflicts.ts).
      // A fresh id has no revision to race, so its links are unconditional.
      return { write, statements: [
        createStatement(db, examId, write.questionId, d.question, now, true, tagIds),
        ...input.chainedStatements(write),
        ...buildTagLinkStatements(db, write.questionId, tagIds, []),
      ] };
    }
    const write: ImportWrite = { kind: "update", index: d.index, examId, questionId: d.row.id, externalId: d.row.external_id };
    // The links are guarded on BOTH the row's post-write revision and `now`:
    // a stale-revision update changes nothing, so its links fail closed in
    // the same batch. Revision alone isn't enough, since a different
    // concurrent writer could legitimately reach the same revision value
    // (see buildTagLinkStatements).
    return { write, statements: [
      updateStatement(db, d.row, d.question, now, true, tagIds),
      ...input.chainedStatements(write),
      ...buildTagLinkStatements(
        db, d.row.id, tagIds, currentTagIdsByQuestion.get(d.row.id) ?? [],
        { questionId: d.row.id, revision: d.row.revision + 1, updatedAt: now },
      ),
    ] };
  });
  return { writes, unchanged };
}

// --- Commit ---------------------------------------------------------------------

// committed: the row write changed a row. stale: it committed but changed
// nothing (the question moved past its previewed revision). rolled_back: its
// batch threw, so nothing in that batch applied.
export type ImportWriteStatus = "committed" | "stale" | "rolled_back";
export interface ImportWriteResult { write: ImportWrite; status: ImportWriteStatus }

// Each batch of `itemsPerBatch` planned writes is one atomic D1 batch. A
// batch that throws is reported through `onRollback` (for the caller's audit
// rows) and its writes come back rolled_back; later batches still run, so a
// run can partially complete, and the results say exactly which items did.
export async function commitImportWrites(
  db: D1Database, writes: PlannedImportWrite[],
  options: { itemsPerBatch: number; onRollback(writes: ImportWrite[]): Promise<void> },
): Promise<ImportWriteResult[]> {
  const results: ImportWriteResult[] = [];
  for (let start = 0; start < writes.length; start += options.itemsPerBatch) {
    const batch = writes.slice(start, start + options.itemsPerBatch);
    // Each item's row write position within the flattened batch, since items
    // carry a variable number of chained and tag-link statements.
    const primaryIndexOf: number[] = [];
    const statements: D1PreparedStatement[] = [];
    for (const p of batch) {
      primaryIndexOf.push(statements.length);
      statements.push(...p.statements);
    }
    try {
      const batchResults = await db.batch(statements);
      batch.forEach((p, i) => results.push({ write: p.write, status: batchResults[primaryIndexOf[i]!]!.meta.changes > 0 ? "committed" : "stale" }));
    } catch {
      await options.onRollback(batch.map((p) => p.write));
      for (const p of batch) results.push({ write: p.write, status: "rolled_back" });
    }
  }
  return results;
}

export type ImportOutcomeStatus = "created" | "updated" | "skipped" | "conflict" | "failed";

// Conflicts count as skipped: the row was left as it is.
export function countImportOutcomes(outcomes: readonly { status: ImportOutcomeStatus }[]) {
  const count = (...statuses: ImportOutcomeStatus[]) => outcomes.filter((o) => statuses.includes(o.status)).length;
  return { created: count("created"), updated: count("updated"), skipped: count("skipped", "conflict"), failed: count("failed") };
}

// --- Archive and log ------------------------------------------------------------

export async function archiveImportFile(bucket: R2Bucket, examId: string, body: string): Promise<string> {
  const key = `imports/${examId}/${Date.now()}-${crypto.randomUUID()}.json`;
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
  return key;
}

// Keeps the import_logs rows indefinitely but bounds raw source retention:
// an old log's download returns 404 once its archived object expires.
export async function cleanOldImportArchives(bucket: R2Bucket, examId: string, keepKey: string): Promise<void> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `imports/${examId}/`, cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const cutoff = Date.now() - ARCHIVE_RETENTION_MS;
  const ordered = objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
  const expired = ordered.filter(
    (object, index) => object.key !== keepKey && (index >= MAX_ARCHIVES_PER_EXAM || object.uploaded.getTime() < cutoff)
  );
  if (expired.length) await bucket.delete(expired.map((object) => object.key));
}

// FR-2.5's import history. Both entry points write it, so MCP-originated
// imports appear in REST's GET /logs too.
export async function recordImportLog(db: D1Database, entry: {
  examId: string; uploadedBy: string; r2ObjectKey: string; questionCount: number; createdAt: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO import_logs (id, exam_id, uploaded_by, r2_object_key, question_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, entry.examId, entry.uploadedBy, entry.r2ObjectKey, entry.questionCount, entry.createdAt).run();
  return id;
}
