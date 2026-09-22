import type { Env } from "../bindings";
import type { McpAudience, McpPrincipal } from "./credentials";
import { McpApplicationError } from "./errors";
import { pageResult } from "./conventions";
import { buildAdminMutationAuditStatement, buildConditionalAdminMutationAuditStatement, recordAdminMutationAudit } from "./audit";
import {
  examExists, getExam as getExamRecord, getExamAttemptCounts, listExams as listExamRecords,
  createExamStatement, updateExamStatement, archiveExamStatement,
  EXAM_SLUG_PATTERN, type ExamCreateFields, type ExamMutableFields,
} from "../lib/examManagement";
import {
  BANK_QUESTION_SCAN_LIMIT, EXAM_QUESTION_SCAN_LIMIT, MAX_BATCH_MUTATION_ITEMS,
  answerKey, createStatement, getQuestion as getQuestionRow,
  listQuestionTags as listQuestionTagRows, listQuestions as listQuestionRows,
  listRecentContentChanges as listRecentContentChangeRows, payloadOf, searchQuestions as searchQuestionsQuery, toQuestion,
  updateStatement, validatePayload, type QuestionPayload, type QuestionRow,
} from "../lib/questionManagement";
import {
  buildCreateOperationStatement, diffPayload, getCreateOperation, getCreateOperations,
  proposalToken, type PayloadDifference,
} from "../lib/questionProposals";
import { invalidatePracticeQuestions } from "../lib/practiceCache";
import {
  buildQuestionSetStatistics, findAnswerReferenceIssues, findDuplicateQuestions as groupDuplicateQuestions,
  hasMissingMetadata, isMissingExplanation, missingMetadataFlags, stemPreview,
} from "../lib/questionQuality";
import {
  findQuestionRows as findQuestionRowsByExternalId, classifyImportRows, cleanOldImportArchives,
  fileToken as computeFileToken, requestFingerprint as computeRequestFingerprint,
  getCommittedImportItems, buildCommittedImportItemStatement, buildConditionalCommittedImportItemStatement,
  type ImportConflictResolution,
} from "../lib/importExecution";
import { assertBoundedDepth, IMPORT_JSON_MAX_DEPTH } from "../lib/importSecurity";
import { normalizeImportFile, exportComponentPackage, validateImportFile as validateImportFileContents, type QuestionImportFile } from "@prepdeck/shared";
import {
  normalizeTagName, resolveOrCreateTags, fetchTagIdsForQuestions, buildTagLinkStatements,
  buildTagNameResolver, findTagCatalogRowByName, listTagCatalogNames,
  renameTagCatalogStatement, touchTagCatalogStatement, reassignTagLinksStatement,
  deleteTagCatalogByIdStatement, registerTagCatalogStatement,
  countQuestionsForTag, countQuestionsForAnyTag, distinctExamIdsForTags, tagResolutionSnapshot,
  sourceDriftCondition, MAX_MERGE_SOURCE_TAGS,
} from "../lib/questionBankTags";
import { pct as accuracyPct, computeStudyActivity, computeExamStatsSummary, computeExamStatsPage } from "../lib/learningStats";
import { toAttempt, listAttempts as listAttemptRows, getAttemptDetail } from "../lib/attemptQuery";
import { listWrongQuestions } from "../lib/wrongBookQuery";
import { listBookmarkedQuestions } from "../lib/bookmarksQuery";
import { listUnattemptedQuestions } from "../lib/unattemptedQuery";
import { selectQuestions, selectQuestionsForReview, type DailyReviewQuestion } from "../lib/practiceSelection";
import {
  buildAnnotationsListQuery, toAnnotation, listAnnotationsForQuestion as listAnnotationsForQuestionRows,
  type AnnotationRow,
} from "../lib/annotationsQuery";
import { buildKnowledgePointsListQuery } from "../lib/knowledgePointsQuery";
import { loadDetail as loadKnowledgePointDetail, toSummary as toKnowledgePointSummary, LIST_SELECT as KP_LIST_SELECT, type KnowledgePointRow } from "../lib/knowledgePointDetail";
import {
  createNote, applyNoteEdit, deleteNote, linkQuestion, unlinkQuestion, attachTag, detachTag, reorderNote,
} from "../lib/knowledgePointMutations";
import { listGroups as listKnowledgePointGroupRows, createGroup as createKnowledgePointGroupRow, renameGroup as renameKnowledgePointGroupRow, deleteGroup as deleteKnowledgePointGroupRow } from "../lib/knowledgePointGroupMutations";
import { listTags as listKnowledgePointTagRows, renameTag as renameKnowledgePointTagRow, deleteTag as deleteKnowledgePointTagRow } from "../lib/knowledgePointTagMutations";
import { SELECT_ORDER_REVISION_SQL } from "../lib/knowledgePointOrderScopes";
import { scopeKeyFor } from "../lib/knowledgePointOrdering";
import { consumeRateLimit, configuredLimit } from "../middleware/rateLimit";

/** Identity-bound service adapter. Add narrowly named application service
 * operations here as business catalogs are implemented. Those operations
 * must close over this principal and call canonical service logic; never
 * proxy HTTP, accept an effective userId, or expose raw DB/SQL to tools.
 */
function identityAdapter(principal: McpPrincipal, audience: McpAudience) {
  if (principal.audience !== audience) throw new McpApplicationError("unauthorized");
  const userId = principal.userId;
  return Object.freeze({
    getIdentity: () => ({ userId, server: audience }),
  });
}

// implementation — User MCP learning, history, and question discovery tools.
// Read-only: no operation here may create an attempt, or mutate bookmarks,
// wrong-book state, learning progress, or anything else. Every operation is
// scoped exclusively to `principal.userId` (checked once via identityAdapter
// above) and never accepts a caller-supplied userId/ownerId. Reuses the same
// service-layer logic as the REST routes and Admin MCP where it already
// exists (lib/examManagement, lib/questionManagement) and adds new
// extracted/pure query modules where no REST equivalent existed yet
// (lib/attemptQuery, lib/wrongBookQuery, lib/bookmarksQuery,
// lib/unattemptedQuery, lib/practiceSelection, lib/annotationsQuery).
const MAX_OVERVIEW_EXAMS = 50;
const MAX_TREND_POINTS = 366;
const MAX_TAG_BREAKDOWN = 200;

// implementation — Knowledge Points bounds. REST has no equivalent caps today
// (these are MCP-only abuse-prevention limits, not retrofitted onto REST) —
// enforced by passing them into the shared lib/knowledgePointMutations.ts
// functions, which REST's own callers simply never do. MAX_TAG_FILTER_IDS
// bounds the `tagIds` *query filter* array on list/search, a different
// concern from MAX_TAGS_PER_NOTE (how many tags one note may carry).
const MAX_TAGS_PER_NOTE = 50;
const MAX_LINKED_QUESTIONS_PER_NOTE = 200;
const MAX_TAG_FILTER_IDS = 20;

export function createUserMcpAdapter(principal: McpPrincipal, env: Env) {
  const identity = identityAdapter(principal, "user");
  const db = env.DB;
  const userId = principal.userId;

  async function requireExam(examId: string): Promise<void> {
    if (!(await examExists(db, examId))) throw new McpApplicationError("not_found");
  }

  // implementation — a second, KP-mutation-specific write quota, distinct from
  // the blanket per-account MCP request quota already applied to every call
  // (including reads) in mcp/routes.ts. Fails closed: an unavailable limiter
  // blocks the write rather than silently allowing it. implementation — max is
  // deployment-configurable via MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE; default
  // matches the original fixed value.
  async function consumeKnowledgePointWriteLimit(): Promise<void> {
    const max = configuredLimit(env.MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE, 30);
    const result = await consumeRateLimit(env, `mcp:user:${userId}:kp-write`, { windowSeconds: 60, max }).catch(() => null);
    // implementation — distinguish "this limiter is unreachable" from an
    // unrelated application failure, and carry the limiter's own
    // retryAfter through to the caller instead of discarding it.
    if (!result) throw new McpApplicationError("unavailable");
    if (!result.allowed) throw new McpApplicationError("rate_limited", { retryAfter: result.retryAfter });
  }

  interface KnowledgePointsListInput {
    groupId?: string;
    ungrouped?: boolean;
    tagIds?: string[];
    q?: string;
    sort?: string;
    linkedQuestionId?: string;
    examId?: string;
    limit: number;
    offset: number;
  }

  // Shared by list/search/get_knowledge_points_for_question — there is
  // exactly one underlying query (buildKnowledgePointsListQuery); the three
  // tools differ only in which fields their own schema requires/prefills.
  async function listNotes(input: KnowledgePointsListInput) {
    if (input.tagIds && input.tagIds.length > MAX_TAG_FILTER_IDS) throw new McpApplicationError("invalid_input");
    const query = buildKnowledgePointsListQuery(userId, input);
    if (!query) throw new McpApplicationError("invalid_input");
    const rowsStatement = db
      .prepare(`${KP_LIST_SELECT} WHERE ${query.where} ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
      .bind(...query.binds, input.limit + 1, input.offset);

    // orderRevision is only meaningful for a single, unfiltered scope view
    // (an explicit groupId or ungrouped, with no other narrowing filter) —
    // it must reflect the *whole* scope a caller would reorder within, not
    // a filtered subset of it. See user_reorder_knowledge_points, which
    // requires this value back as expectedOrderRevision.
    const extra: Record<string, unknown> = {};
    const isSingleUnfilteredScope = (input.ungrouped || !!input.groupId) && !input.tagIds?.length && !input.q && !input.linkedQuestionId && !input.examId;
    if (isSingleUnfilteredScope) {
      const scopeKey = input.ungrouped ? scopeKeyFor(null) : scopeKeyFor(input.groupId!);
      // Read the rows and the scope's order revision as one atomic batch —
      // two separate round trips here would leave a window where a
      // concurrent reorder lands in between, producing a response whose
      // orderRevision doesn't actually describe the rows just returned. A
      // caller could then submit a reorder using that orderRevision (which
      // legitimately matches the CURRENT state) against a beforeId chosen
      // from the STALE list they were shown, defeating the purpose of the
      // CAS check for this particular read.
      const [rowsResult, revisionResult] = await db.batch<KnowledgePointRow | { revision: number }>([
        rowsStatement,
        db.prepare(SELECT_ORDER_REVISION_SQL).bind(userId, scopeKey),
      ]);
      extra.orderRevision = (revisionResult!.results?.[0] as { revision: number } | undefined)?.revision ?? 1;
      return page(((rowsResult!.results as KnowledgePointRow[] | undefined) ?? []).map(toKnowledgePointSummary), input, extra);
    }

    const { results } = await rowsStatement.all<KnowledgePointRow>();
    return page((results ?? []).map(toKnowledgePointSummary), input, extra);
  }

  return Object.freeze({
    ...identity,

    // --- Learning overview and statistics -----------------------------------
    // Three separate per-exam aggregate queries, merged in application code —
    // deliberately NOT one join across attempts/bookmarks/wrong_question_book,
    // which (being unrelated one-to-many relations on the same exam) would
    // fan out rows and inflate counts (e.g. 3 bookmarks x 5 wrong entries on
    // one exam miscounted as 15 of something).
    async getLearningOverview(input: { days: number }) {
      const [attemptRows, bookmarkRows, wrongRows] = await Promise.all([
        db.prepare(
          `SELECT a.exam_id AS exam_id,
                  COUNT(DISTINCT aa.question_id) AS attempted_questions,
                  COUNT(aa.id) AS total_answers,
                  COALESCE(SUM(aa.is_correct), 0) AS correct_answers,
                  MAX(a.completed_at) AS last_attempt_at
           FROM attempts a
           LEFT JOIN attempt_answers aa ON aa.attempt_id = a.id
           WHERE a.user_id = ? AND a.completed_at IS NOT NULL
           GROUP BY a.exam_id`,
        ).bind(userId).all<{ exam_id: string; attempted_questions: number; total_answers: number; correct_answers: number; last_attempt_at: string | null }>(),
        db.prepare(
          `SELECT q.exam_id AS exam_id, COUNT(*) AS n FROM bookmarks b JOIN questions q ON q.id = b.question_id
           WHERE b.user_id = ? GROUP BY q.exam_id`,
        ).bind(userId).all<{ exam_id: string; n: number }>(),
        db.prepare(
          `SELECT q.exam_id AS exam_id, COUNT(*) AS n FROM wrong_question_book w JOIN questions q ON q.id = w.question_id
           WHERE w.user_id = ? AND w.mastered = 0 GROUP BY q.exam_id`,
        ).bind(userId).all<{ exam_id: string; n: number }>(),
      ]);

      const bookmarkByExam = new Map((bookmarkRows.results ?? []).map((r) => [r.exam_id, r.n]));
      const wrongByExam = new Map((wrongRows.results ?? []).map((r) => [r.exam_id, r.n]));
      const examIds = new Set<string>([
        ...(attemptRows.results ?? []).map((r) => r.exam_id),
        ...bookmarkByExam.keys(),
        ...wrongByExam.keys(),
      ]);
      if (examIds.size === 0) {
        return { exams: [], truncated: false, activity: await computeStudyActivity(db, userId, { days: input.days }) };
      }

      // A single JSON parameter, not one bound parameter per touched exam —
      // a user with bookmarks/history across 100+ exams would otherwise push
      // this past D1's documented 100-bound-parameter limit before the
      // MAX_OVERVIEW_EXAMS truncation below ever runs.
      const { results: examRows } = await db.prepare(
        "SELECT id, name, slug FROM exams WHERE id IN (SELECT value FROM json_each(?))",
      ).bind(JSON.stringify([...examIds])).all<{ id: string; name: string; slug: string }>();
      const examById = new Map((examRows ?? []).map((r) => [r.id, r]));

      const byExam = new Map((attemptRows.results ?? []).map((r) => [r.exam_id, r]));
      const merged = [...examIds].map((examId) => {
        const exam = examById.get(examId);
        const a = byExam.get(examId);
        return {
          examId,
          examName: exam?.name ?? null,
          examSlug: exam?.slug ?? null,
          totalAttempted: a?.attempted_questions ?? 0,
          overallAccuracyPct: accuracyPct(a?.correct_answers ?? 0, a?.total_answers ?? 0),
          lastAttemptAt: a?.last_attempt_at ?? null,
          bookmarkedCount: bookmarkByExam.get(examId) ?? 0,
          activeWrongCount: wrongByExam.get(examId) ?? 0,
        };
      });
      merged.sort((x, y) => {
        if (x.lastAttemptAt && y.lastAttemptAt) return y.lastAttemptAt.localeCompare(x.lastAttemptAt);
        if (x.lastAttemptAt) return -1;
        if (y.lastAttemptAt) return 1;
        return (x.examName ?? "").localeCompare(y.examName ?? "");
      });

      return {
        exams: merged.slice(0, MAX_OVERVIEW_EXAMS),
        truncated: merged.length > MAX_OVERVIEW_EXAMS,
        // `days` only bounds the activity summary below — the per-exam
        // accuracy figures above are all-time, matching computeExamStats.
        activity: await computeStudyActivity(db, userId, { days: input.days }),
      };
    },

    async getExamProgress(input: { examId: string }) {
      const exam = await getExamRecord(db, input.examId);
      if (!exam) throw new McpApplicationError("not_found");
      // Summary-only (no trend/tag/mock-history queries) — this tool only
      // ever reads three fields off the stats, so it must not run (or
      // KV-cache) the REST dashboard's full computeExamStats to get them.
      const [progressRow, bookmarkCount, wrongCount, stats] = await Promise.all([
        db.prepare("SELECT last_sequence_number FROM learning_progress WHERE user_id = ? AND exam_id = ?")
          .bind(userId, input.examId).first<{ last_sequence_number: number }>(),
        db.prepare(
          `SELECT COUNT(*) AS n FROM bookmarks b JOIN questions q ON q.id = b.question_id WHERE b.user_id = ? AND q.exam_id = ?`,
        ).bind(userId, input.examId).first<{ n: number }>(),
        db.prepare(
          `SELECT COUNT(*) AS n FROM wrong_question_book w JOIN questions q ON q.id = w.question_id WHERE w.user_id = ? AND q.exam_id = ? AND w.mastered = 0`,
        ).bind(userId, input.examId).first<{ n: number }>(),
        computeExamStatsSummary(db, userId, input.examId),
      ]);
      return {
        examId: exam.id,
        examName: exam.name,
        questionCount: exam.questionCount,
        lastSequenceNumber: progressRow?.last_sequence_number ?? null,
        bookmarkedCount: bookmarkCount?.n ?? 0,
        activeWrongCount: wrongCount?.n ?? 0,
        totalAttempted: stats?.totalAttempted ?? 0,
        overallAccuracyPct: stats?.overallAccuracyPct ?? 0,
        lastAttemptAt: stats?.lastAttemptAt ?? null,
      };
    },

    // SQL-bounded statistics via computeExamStatsPage (lib/learningStats.ts)
    // — NOT the REST dashboard's cached, full-history computeExamStats/
    // getOrComputeExamStats: mockScoreHistory grows unboundedly with usage
    // (one entry per completed mock attempt, forever) and accuracyTrend/byTag
    // are capped at the SQL layer (latest trendCap days / top tagCap tags),
    // so even a `limit: 1` call here never fetches, maps, or KV-caches a
    // user's entire history. REST's own ExamStatsResponse (the dashboard
    // chart) is untouched by this — it keeps its separate cached path.
    async getLearningStats(input: { examId: string; limit: number; offset: number }) {
      const page = await computeExamStatsPage(db, userId, input.examId, {
        trendCap: MAX_TREND_POINTS, tagCap: MAX_TAG_BREAKDOWN, mockLimit: input.limit, mockOffset: input.offset,
      });
      if (!page) throw new McpApplicationError("not_found");
      const { items: mockScoreHistory, nextOffset: mockScoreHistoryNextOffset } =
        pageResult(page.mockScoreHistoryRows, { limit: input.limit, offset: input.offset });
      return {
        examId: page.examId,
        totalAttempted: page.totalAttempted,
        overallAccuracyPct: page.overallAccuracyPct,
        lastAttemptAt: page.lastAttemptAt,
        accuracyTrend: page.accuracyTrend,
        accuracyTrendTruncated: page.accuracyTrendTruncated,
        byTag: page.byTag,
        byTagTruncated: page.byTagTruncated,
        byDifficulty: page.byDifficulty,
        mockScoreHistory,
        mockScoreHistoryNextOffset,
      };
    },

    // --- Attempts and review sets --------------------------------------------
    async listAttempts(input: { examId?: string; mode?: "practice" | "mock"; completedOnly?: boolean; limit: number; offset: number }) {
      const rows = await listAttemptRows(db, userId, input);
      return page(rows.map(toAttempt), input);
    },

    async getAttempt(input: { id: string; breakdownLimit: number; breakdownOffset: number }) {
      const detail = await getAttemptDetail(db, userId, input.id, {
        breakdownLimit: input.breakdownLimit, breakdownOffset: input.breakdownOffset,
      });
      if (!detail) throw new McpApplicationError("not_found");
      return detail;
    },

    async getRecentAttempts(input: { examId?: string; limit: number }) {
      const rows = await listAttemptRows(db, userId, { examId: input.examId, limit: input.limit, offset: 0 });
      return { attempts: rows.slice(0, input.limit).map(toAttempt) };
    },

    async getWrongQuestions(input: { examId?: string; includeMastered: boolean; limit: number; offset: number }) {
      const rows = await listWrongQuestions(db, userId, input);
      return page(rows, input);
    },

    async getBookmarkedQuestions(input: { examId?: string; limit: number; offset: number }) {
      const rows = await listBookmarkedQuestions(db, userId, input);
      return page(rows, input);
    },

    async getUnattemptedQuestions(input: { examId: string; limit: number; offset: number }) {
      await requireExam(input.examId);
      const rows = await listUnattemptedQuestions(db, userId, input.examId, input);
      return page(rows, input);
    },

    // --- Question/exam discovery ---------------------------------------------
    // Returns the full question record, including correctAnswers/explanation
    // — a deliberate User MCP product decision (confirmed explicitly), not a
    // reflection of an existing REST permission: routes/questions.ts's
    // generic question read is itself requireAdmin-gated.
    async searchQuestions(input: { examId: string; q?: string; type?: string; difficulty?: string; tag?: string; limit: number; offset: number }) {
      return searchQuestionsQuery(db, input.examId, input);
    },

    async getQuestion(input: { examId: string; id: string }) {
      const row = await getQuestionRow(db, input.examId, input.id);
      if (!row) throw new McpApplicationError("not_found");
      return { question: toQuestion(row) };
    },

    // No includeArchived param — matches routes/exams.ts, which only lets
    // role === "admin" list archived exams.
    async listExams(input: { limit: number; offset: number }) {
      const rows = await listExamRecords(db, { includeArchived: false, limit: input.limit + 1, offset: input.offset });
      const { items, nextOffset } = pageResult(rows, { limit: input.limit, offset: input.offset });
      return { exams: items, nextOffset };
    },

    // Works for an archived exam by id — matches REST GET /:id, which
    // doesn't filter archived_at (only listing archived exams is gated).
    async getExam(input: { id: string }) {
      const exam = await getExamRecord(db, input.id);
      if (!exam) throw new McpApplicationError("not_found");
      return { exam };
    },

    async listQuestionTags(input: { examId?: string; limit: number; offset: number }) {
      if (input.examId) await requireExam(input.examId);
      const rows = await listQuestionTagRows(db, input);
      return page(rows, input);
    },

    // --- Study selection ------------------------------------------------------
    // All supplied flags are ANDed (a question must satisfy every enabled
    // restriction simultaneously). Never selects correctAnswers/explanation —
    // deliberately separate from the discovery tools above: these are
    // pre-practice candidate pools, and handing out the answer before
    // practicing defeats their purpose (same rationale as
    // lib/dailyReviewSelection.ts's header comment).
    async getPracticeCandidates(input: {
      examId?: string; type?: string; difficulty?: string; tag?: string;
      unattemptedOnly?: boolean; wrongOnly?: boolean; bookmarkedOnly?: boolean; limit: number;
    }) {
      const questions = await selectQuestions(db, userId, input, input.limit);
      return { questions };
    },

    async getQuestionsForReview(input: {
      examId?: string; source?: "wrong" | "bookmarked" | "both"; type?: string; difficulty?: string; tag?: string; limit: number;
    }) {
      const questions = await selectQuestionsForReview(db, userId, input, input.limit);
      return { questions };
    },

    // Blended "what to study next": wrong-book -> bookmarked -> unattempted,
    // each pass excluding ids already picked via a hard SQL NOT IN — never
    // the soft JS fallback dailyReviewSelection.ts uses, so the combined
    // result is guaranteed duplicate-free.
    async getRecommendedQuestions(input: { examId?: string; limit: number }) {
      const picked: DailyReviewQuestion[] = [];
      const remaining = () => input.limit - picked.length;
      if (remaining() > 0) {
        picked.push(...await selectQuestionsForReview(db, userId, { examId: input.examId, source: "wrong" }, remaining()));
      }
      if (remaining() > 0) {
        picked.push(...await selectQuestionsForReview(
          db, userId, { examId: input.examId, source: "bookmarked", excludeIds: picked.map((q) => q.id) }, remaining(),
        ));
      }
      if (remaining() > 0) {
        picked.push(...await selectQuestions(
          db, userId, { examId: input.examId, unattemptedOnly: true, excludeIds: picked.map((q) => q.id) }, remaining(),
        ));
      }
      return { questions: picked };
    },

    // --- Annotations ----------------------------------------------------------
    async listAnnotations(input: { examId?: string; markType?: string; sort?: "asc" | "desc"; limit: number; offset: number }) {
      const built = buildAnnotationsListQuery(userId, input.markType, input.sort, input.examId, { limit: input.limit, offset: input.offset });
      if (!built) throw new McpApplicationError("invalid_input");
      const { results } = await db.prepare(built.sql).bind(...built.binds).all<AnnotationRow>();
      return page((results ?? []).map(toAnnotation), input);
    },

    async getAnnotationsForQuestion(input: { questionId: string; limit: number; offset: number }) {
      const rows = await listAnnotationsForQuestionRows(db, userId, input.questionId, input);
      return page(rows.map(toAnnotation), input);
    },

    // --- Knowledge Points (implementation) -----------------------------------------
    // Reuses implementation's canonical rules via lib/knowledgePointMutations.ts,
    // lib/knowledgePointDetail.ts, lib/knowledgePointGroupMutations.ts, and
    // lib/knowledgePointTagMutations.ts — the exact same functions REST's
    // routes/knowledgePoints*.ts call — rather than a parallel
    // implementation. Cross-user access to a knowledge point, group, tag, or
    // attachment reads identically to nonexistent (not_found), matching
    // every other read method in this adapter.
    async listKnowledgePoints(input: KnowledgePointsListInput) {
      return listNotes(input);
    },

    async searchKnowledgePoints(input: KnowledgePointsListInput & { q: string }) {
      return listNotes(input);
    },

    async getKnowledgePointsForQuestion(input: { questionId: string; limit: number; offset: number }) {
      return listNotes({ linkedQuestionId: input.questionId, limit: input.limit, offset: input.offset });
    },

    async getKnowledgePoint(input: { id: string }) {
      const detail = await loadKnowledgePointDetail(db, input.id, userId);
      if (!detail) throw new McpApplicationError("not_found");
      return { knowledgePoint: detail };
    },

    async listKnowledgePointGroups(input: { limit: number; offset: number }) {
      const { groups, total, ungroupedCount } = await listKnowledgePointGroupRows(db, userId, { limit: input.limit + 1, offset: input.offset });
      return page(groups, input, { total, ungroupedCount });
    },

    async listKnowledgePointTags(input: { limit: number; offset: number }) {
      const { tags, total } = await listKnowledgePointTagRows(db, userId, { limit: input.limit + 1, offset: input.offset });
      return page(tags, input, { total });
    },

    // Per implementation, create may seed initial content and relationships
    // atomically (default: today's blank-note behavior) rather than forcing
    // N follow-up mutation calls that could leave a caller with a
    // half-tagged note if it gives up partway through.
    async createKnowledgePoint(input: { groupId?: string | null; title?: string; bodyMarkdown?: string; tagNames?: string[]; linkedQuestionIds?: string[] }) {
      await consumeKnowledgePointWriteLimit();
      const result = await createNote(db, {
        userId, groupId: input.groupId, title: input.title, bodyMarkdown: input.bodyMarkdown,
        tagNames: input.tagNames, linkedQuestionIds: input.linkedQuestionIds,
        maxTags: MAX_TAGS_PER_NOTE, maxLinkedQuestions: MAX_LINKED_QUESTIONS_PER_NOTE,
      });
      if (!result.ok) {
        if (result.reason === "group_not_found" || result.reason === "question_not_found") throw new McpApplicationError("not_found");
        throw new McpApplicationError("invalid_input");
      }
      return { knowledgePoint: await loadKnowledgePointDetail(db, result.id, userId) };
    },

    // Content (title/bodyMarkdown) and an optional group move are applied
    // atomically under one revision check — see lib/knowledgePointMutations.ts's
    // applyNoteEdit for why this can't just be two separate calls the way
    // REST's own PUT/PATCH endpoints are.
    async updateKnowledgePoint(input: { id: string; baseRevision: number; title?: string; bodyMarkdown?: string; groupId?: string | null }) {
      await consumeKnowledgePointWriteLimit();
      const result = await applyNoteEdit(db, { id: input.id, userId, baseRevision: input.baseRevision, title: input.title, bodyMarkdown: input.bodyMarkdown, groupId: input.groupId });
      if (!result.ok) {
        if (result.reason === "not_found" || result.reason === "group_not_found") throw new McpApplicationError("not_found");
        throw new McpApplicationError("conflict");
      }
      return { knowledgePoint: result.detail };
    },

    // No revision check on delete — REST's own DELETE /:id has none either;
    // deletion is already explicit via requiring the exact id. Never
    // cascades to the note's group, tags, or linked questions themselves.
    async deleteKnowledgePoint(input: { id: string }) {
      await consumeKnowledgePointWriteLimit();
      const deleted = await deleteNote(db, env.BUCKET, { id: input.id, userId });
      if (!deleted) throw new McpApplicationError("not_found");
      return { deleted: true };
    },

    async linkKnowledgePointQuestion(input: { id: string; questionId: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await linkQuestion(db, { id: input.id, userId, questionId: input.questionId, maxLinkedQuestions: MAX_LINKED_QUESTIONS_PER_NOTE });
      if (!result.ok) {
        if (result.reason === "cap_exceeded") throw new McpApplicationError("invalid_input");
        throw new McpApplicationError("not_found");
      }
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    async unlinkKnowledgePointQuestion(input: { id: string; questionId: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await unlinkQuestion(db, { id: input.id, userId, questionId: input.questionId });
      if (!result.ok) throw new McpApplicationError("not_found");
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    async createKnowledgePointGroup(input: { name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await createKnowledgePointGroupRow(db, { userId, name: input.name });
      if (!result.ok) {
        if (result.reason === "duplicate") throw new McpApplicationError("conflict");
        throw new McpApplicationError("invalid_input");
      }
      return { group: result.group };
    },

    async renameKnowledgePointGroup(input: { id: string; name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await renameKnowledgePointGroupRow(db, { id: input.id, userId, name: input.name });
      if (!result.ok) {
        if (result.reason === "not_found") throw new McpApplicationError("not_found");
        if (result.reason === "duplicate") throw new McpApplicationError("conflict");
        throw new McpApplicationError("invalid_input");
      }
      return { group: result.group };
    },

    async deleteKnowledgePointGroup(input: { id: string }) {
      await consumeKnowledgePointWriteLimit();
      const deleted = await deleteKnowledgePointGroupRow(db, { id: input.id, userId });
      if (!deleted) throw new McpApplicationError("not_found");
      return { deleted: true };
    },

    // Attach-by-name to one note (find-or-create) — matches REST's only
    // "create a tag" entry point (there is no bare tag-catalog-create).
    async createKnowledgePointTag(input: { id: string; name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await attachTag(db, { id: input.id, userId, name: input.name, maxTags: MAX_TAGS_PER_NOTE });
      if (!result.ok) {
        if (result.reason === "kp_not_found") throw new McpApplicationError("not_found");
        throw new McpApplicationError("invalid_input");
      }
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    // Global rename of the tag catalog entry — affects every note carrying it.
    async renameKnowledgePointTag(input: { id: string; name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await renameKnowledgePointTagRow(db, { id: input.id, userId, name: input.name });
      if (!result.ok) {
        if (result.reason === "not_found") throw new McpApplicationError("not_found");
        if (result.reason === "duplicate") throw new McpApplicationError("conflict");
        throw new McpApplicationError("invalid_input");
      }
      return { tag: result.tag };
    },

    // Global delete of the tag catalog entry — removes it from every note
    // that carries it, but never deletes those notes.
    async deleteKnowledgePointTag(input: { id: string }) {
      await consumeKnowledgePointWriteLimit();
      const deleted = await deleteKnowledgePointTagRow(db, { id: input.id, userId });
      if (!deleted) throw new McpApplicationError("not_found");
      return { deleted: true };
    },

    // Detaches one tag from one note without deleting the tag itself or its
    // links to any other note — the operation REST's tag-catalog naming
    // otherwise leaves no room for (its only "delete a tag" endpoint is the
    // global one above), symmetric with link/unlink_knowledge_point_question.
    async unlinkKnowledgePointTag(input: { id: string; tagId: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await detachTag(db, { id: input.id, userId, tagId: input.tagId });
      if (!result.ok) throw new McpApplicationError("not_found");
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    // Requires expectedOrderRevision (from listKnowledgePoints'/
    // getKnowledgePointsForQuestion's `orderRevision`, when scoped to a
    // single group/ungrouped view) so a stale/concurrent reorder is
    // rejected rather than silently applied — see
    // lib/knowledgePointMutations.ts's reorderNote.
    async reorderKnowledgePoints(input: { id: string; beforeId: string | null; expectedOrderRevision: number }) {
      await consumeKnowledgePointWriteLimit();
      const result = await reorderNote(db, { id: input.id, userId, beforeId: input.beforeId, expectedOrderRevision: input.expectedOrderRevision });
      if (!result.ok) {
        if (result.reason === "not_found" || result.reason === "before_not_found") throw new McpApplicationError("not_found");
        if (result.reason === "cross_group") throw new McpApplicationError("invalid_input");
        if (result.reason === "conflict") throw new McpApplicationError("conflict");
        throw new McpApplicationError("internal");
      }
      return { position: result.position };
    },
  });
}

interface Page { limit: number; offset: number }

// Bounded/paginated result envelope shared by every list-returning admin
// tool below, built on conventions.ts's pageResult() so every tool's
// output has the same {items, nextOffset} shape. pageResult() itself
// assumes `rows` is already windowed by `offset` (its own doc comment:
// "Query at most limit + 1 rows after applying authorization and
// filters") — true for the SQL-paginated tools (getRecentContentChanges,
// listTags), which query `LIMIT limit + 1 OFFSET offset` and can pass
// their rows straight through.
function page<T>(rows: T[], input: Page, extra?: Record<string, unknown>) {
  const { items, nextOffset } = pageResult(rows, { limit: input.limit, offset: input.offset });
  return { items, nextOffset, ...extra };
}

// The find_* quality tools instead scan a whole exam and filter in memory,
// so their `matches` array starts at index 0 regardless of `offset`. Window
// it to the same `limit + 1` slice an equivalent SQL query would have
// returned before handing it to page(), or `offset` would be silently
// ignored and every page past the first would repeat page one.
function pageInMemory<T>(rows: T[], input: Page, extra?: Record<string, unknown>) {
  return page(rows.slice(input.offset, input.offset + input.limit + 1), input, extra);
}

// Trimmed, list-friendly view of a question — full content is available via
// admin_get_question. Keeps find_* results compact for an MCP client.
function summarize(q: { id: string; examId: string; externalId: string | null; sequenceNumber: number; type: string; stem: string; updatedAt: string }) {
  return {
    id: q.id, examId: q.examId, externalId: q.externalId, sequenceNumber: q.sequenceNumber,
    type: q.type, stemPreview: stemPreview(q.stem), updatedAt: q.updatedAt,
  };
}

// implementation — Admin MCP question-bank read and quality-control tools.
// Read-only: no operation here may mutate `db`. All operations require an
// admin-audience principal (checked once below via identityAdapter) and
// reuse the same service-layer logic as the Admin REST routes and UI
// (lib/examManagement, lib/questionManagement, lib/questionQuality) rather
// than duplicating query logic, per implementation's "share management logic with the
// future Admin MCP" and implementation's "reuse existing admin/service-layer query
// logic where practical".
export function createAdminMcpAdapter(principal: McpPrincipal, env: Env) {
  const identity = identityAdapter(principal, "admin");
  const db = env.DB;

  async function requireExam(examId: string): Promise<void> {
    if (!(await examExists(db, examId))) throw new McpApplicationError("not_found");
  }

  async function requireQuestion(examId: string, questionId: string) {
    const row = await getQuestionRow(db, examId, questionId);
    if (!row) throw new McpApplicationError("not_found");
    return row;
  }

  // implementation — a stricter, mutation-specific write quota for Admin MCP,
  // distinct from the blanket per-account request quota already applied to
  // every call (including reads) in mcp/routes.ts. Content mutations are the
  // highest-blast-radius operation this surface exposes, so they get a
  // tighter budget than reads. Imports already have their own native
  // Cloudflare rate limiters (IMPORT_VALIDATE_RATE_LIMITER/
  // IMPORT_EXECUTE_RATE_LIMITER, consumed further below) and are exempt from
  // this one. Fails closed: an unavailable limiter blocks the mutation
  // rather than silently allowing it. One call to this consumes one unit
  // regardless of how many items a batch tool's call mutates.
  async function consumeAdminMutationLimit(): Promise<void> {
    const max = configuredLimit(env.MCP_ADMIN_MUTATION_RATE_LIMIT_PER_MINUTE, 10);
    const result = await consumeRateLimit(env, `mcp:admin:${principal.userId}:mutation`, { windowSeconds: 60, max }).catch(() => null);
    // implementation — same distinction/retryAfter propagation as
    // consumeKnowledgePointWriteLimit above.
    if (!result) throw new McpApplicationError("unavailable");
    if (!result.allowed) throw new McpApplicationError("rate_limited", { retryAfter: result.retryAfter });
  }

  // Full in-scope question set for the quality-control/statistics tools,
  // which need every matching row (not a single page) to compute
  // deterministic checks. Bounded by EXAM_QUESTION_SCAN_LIMIT.
  async function loadExamQuestions(examId: string) {
    const rows = await listQuestionRows(db, { examId, limit: EXAM_QUESTION_SCAN_LIMIT });
    return rows.map(toQuestion);
  }

  // --- Import execution helpers (implementation) ----------------------------------
  const STALE_IMPORT_MS = 2 * 60 * 1000;

  interface ImportJobRow {
    id: string; exam_id: string; admin_user_id: string; file_token: string; request_fingerprint: string;
    status: "in_progress" | "completed" | "partial" | "failed";
    question_count: number; created_count: number; updated_count: number; skipped_count: number; failed_count: number;
    r2_object_key: string | null; result_json: string | null;
    created_at: number; updated_at: number; completed_at: number | null;
  }

  // assertBoundedDepth throws a plain ExcessiveNestingError (see
  // lib/importSecurity.ts) — remapped here to invalid_input so it surfaces to
  // the caller as a normal validation failure rather than falling through
  // defineMcpTool's catch-all to "internal".
  function assertImportFileDepth(file: unknown): void {
    try {
      assertBoundedDepth(file, IMPORT_JSON_MAX_DEPTH);
    } catch {
      throw new McpApplicationError("invalid_input");
    }
  }

  async function consumeImportRateLimit(kind: "validate" | "execute", examId: string): Promise<void> {
    const limiter = kind === "validate" ? env.IMPORT_VALIDATE_RATE_LIMITER : env.IMPORT_EXECUTE_RATE_LIMITER;
    // implementation — same unavailable/rate_limited distinction as the other
    // operation-level limiters. Cloudflare's native Rate Limiting binding
    // doesn't return a retryAfter, unlike the Durable-Object-backed
    // consumeRateLimit() the other two limiters use, so there is none to
    // propagate here.
    const result = await limiter.limit({ key: `${principal.userId}:${examId}` }).catch(() => null);
    if (!result) throw new McpApplicationError("unavailable");
    if (!result.success) throw new McpApplicationError("rate_limited");
  }

  // Atomically claims `importId` for this execute attempt via the PRIMARY KEY
  // insert itself: two concurrent executes of the same importId race the
  // same INSERT and exactly one wins, so there is no separate check-then-
  // insert window for the loser to slip through. See the plan's "Import
  // execute: concurrency, durability, and replay" section for the full state
  // machine below (fingerprint mismatch, terminal replay, stale-failure
  // clearing, and stale in_progress takeover).
  async function claimImportJob(claim: {
    importId: string; examId: string; fileTok: string; fingerprint: string; questionCount: number;
  }): Promise<{ resuming: boolean; row: ImportJobRow }> {
    const nowMs = Date.now();
    try {
      await db.prepare(
        `INSERT INTO admin_mcp_import_jobs
           (id, exam_id, admin_user_id, file_token, request_fingerprint, status, question_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
      ).bind(claim.importId, claim.examId, principal.userId, claim.fileTok, claim.fingerprint, claim.questionCount, nowMs, nowMs).run();
      const row = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").bind(claim.importId).first<ImportJobRow>();
      return { resuming: false, row: row! };
    } catch {
      const existing = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").bind(claim.importId).first<ImportJobRow>();
      if (!existing) throw new McpApplicationError("internal");
      if (existing.request_fingerprint !== claim.fingerprint) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: claim.examId, targetIds: [claim.importId],
          outcome: "failure", detail: { reason: "proposal_id_reused_with_different_request" },
        });
        throw new McpApplicationError("conflict");
      }
      if (existing.status !== "in_progress") {
        const hasCommitted = existing.created_count > 0 || existing.updated_count > 0;
        if (hasCommitted || existing.status !== "failed") return { resuming: true, row: existing };
        // Terminal failure with nothing ever committed — nothing to preserve,
        // so clear the stale claim and let the caller retry as if this
        // importId were unused. The WHERE clause re-checks the same
        // predicate so a second concurrent retrier can't also "win" this
        // delete and then both proceed to insert fresh claims.
        const cleared = await db.prepare(
          "DELETE FROM admin_mcp_import_jobs WHERE id = ? AND status = 'failed' AND created_count = 0 AND updated_count = 0",
        ).bind(claim.importId).run();
        if (cleared.meta.changes === 0) return { resuming: true, row: existing };
        return claimImportJob(claim);
      }
      const isStale = nowMs - existing.updated_at > STALE_IMPORT_MS;
      if (!isStale) throw new McpApplicationError("conflict");
      const cas = await db.prepare("UPDATE admin_mcp_import_jobs SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(nowMs, claim.importId, existing.updated_at).run();
      if (cas.meta.changes === 0) throw new McpApplicationError("conflict");
      return { resuming: true, row: { ...existing, updated_at: nowMs } };
    }
  }

  return Object.freeze({
    ...identity,

    // --- Question-bank reads ------------------------------------------------
    async searchQuestions(input: { examId: string; q?: string; type?: string; difficulty?: string; tag?: string; limit: number; offset: number }) {
      return searchQuestionsQuery(db, input.examId, input);
    },

    async getQuestion(input: { examId: string; id: string }) {
      const row = await getQuestionRow(db, input.examId, input.id);
      if (!row) throw new McpApplicationError("not_found");
      return { question: toQuestion(row) };
    },

    async listExams(input: { includeArchived: boolean; limit: number; offset: number }) {
      const rows = await listExamRecords(db, {
        includeArchived: input.includeArchived,
        limit: input.limit + 1,
        offset: input.offset,
      });
      const { items, nextOffset } = pageResult(rows, { limit: input.limit, offset: input.offset });
      return { exams: items, nextOffset };
    },

    async getExam(input: { id: string }) {
      const exam = await getExamRecord(db, input.id);
      if (!exam) throw new McpApplicationError("not_found");
      return { exam };
    },

    async getExamStatistics(input: { examId: string }) {
      const exam = await getExamRecord(db, input.examId);
      if (!exam) throw new McpApplicationError("not_found");
      const questions = await loadExamQuestions(input.examId);
      const attempts = await getExamAttemptCounts(db, input.examId);
      return { exam, statistics: buildQuestionSetStatistics(questions, EXAM_QUESTION_SCAN_LIMIT), attempts };
    },

    // --- Quality-control and maintenance reads -------------------------------
    async findDuplicateQuestions(input: { examId: string; limit: number; offset: number }) {
      await requireExam(input.examId);
      const questions = await loadExamQuestions(input.examId);
      return pageInMemory(groupDuplicateQuestions(questions), input, scanMeta(questions.length));
    },

    async findQuestionsMissingExplanations(input: { examId: string; limit: number; offset: number }) {
      await requireExam(input.examId);
      const questions = await loadExamQuestions(input.examId);
      const matches = questions.filter(isMissingExplanation).map(summarize);
      return pageInMemory(matches, input, scanMeta(questions.length));
    },

    async findQuestionsWithInvalidAnswerReferences(input: { examId: string; limit: number; offset: number }) {
      await requireExam(input.examId);
      const questions = await loadExamQuestions(input.examId);
      const matches = questions
        .map((q) => ({ ...summarize(q), issues: findAnswerReferenceIssues(q) }))
        .filter((entry) => entry.issues.length > 0);
      return pageInMemory(matches, input, scanMeta(questions.length));
    },

    async findQuestionsMissingMetadata(input: { examId: string; limit: number; offset: number }) {
      await requireExam(input.examId);
      const questions = await loadExamQuestions(input.examId);
      const matches = questions
        .map((q) => ({ ...summarize(q), ...missingMetadataFlags(q) }))
        .filter((entry) => hasMissingMetadata(entry));
      return pageInMemory(matches, input, scanMeta(questions.length));
    },

    async getQuestionBankStatistics() {
      const rows = await listQuestionRows(db, { limit: BANK_QUESTION_SCAN_LIMIT });
      const questions = rows.map(toQuestion);
      const byExam = new Map<string, number>();
      for (const q of questions) byExam.set(q.examId, (byExam.get(q.examId) ?? 0) + 1);
      return {
        statistics: buildQuestionSetStatistics(questions, BANK_QUESTION_SCAN_LIMIT),
        examsScanned: byExam.size,
        byExam: [...byExam.entries()].map(([examId, questionCount]) => ({ examId, questionCount })),
      };
    },

    async getRecentContentChanges(input: { examId?: string; sinceMs?: number; limit: number; offset: number }) {
      if (input.examId) await requireExam(input.examId);
      const rows = await listRecentContentChangeRows(db, input);
      return page(rows.map(toQuestion), input);
    },

    // --- Metadata reads -------------------------------------------------------
    // Augmented for implementation: every returned tag gets a `registered` flag
    // (true if it has a question_bank_tags catalog row), and — only on the
    // bank-wide (no examId), last page — catalog rows with zero current
    // question references are appended with questionCount: 0. Without this,
    // an admin_create_tag'd tag with no questions yet would never appear in
    // any listing.
    // implementation (review round 2): the combined used+unregistered set is
    // built and sorted BEFORE paginating, not per-page — SQL-paginating the
    // usage query first and only then appending unused catalog names on
    // "the last page" (the original version) both missed catalog names
    // already covered by an earlier page (re-appending them with a wrong
    // zero count) and could return more than `limit` items on that page.
    // Tags are expected to number in at most the low thousands, so one
    // bounded full scan (TAG_LIST_SCAN_LIMIT) plus in-memory pagination
    // (pageInMemory, already used by the quality-control tools below for
    // the same reason) is simpler and correct, unlike SQL-side pagination
    // over two different sources.
    async listTags(input: { examId?: string; limit: number; offset: number }) {
      if (input.examId) await requireExam(input.examId);
      const TAG_LIST_SCAN_LIMIT = 5000;
      const usageRows = await listQuestionTagRows(db, { examId: input.examId, limit: TAG_LIST_SCAN_LIMIT, offset: 0 });
      const combined = new Map<string, { tag: string; questionCount: number; registered: boolean }>();
      for (const row of usageRows) combined.set(row.tag.toLowerCase(), { tag: row.tag, questionCount: row.questionCount, registered: false });
      const catalogNames = await listTagCatalogNames(db);
      for (const name of catalogNames) {
        const key = name.toLowerCase();
        const existing = combined.get(key);
        if (existing) existing.registered = true;
        // A bank-wide listing also surfaces catalog entries with zero
        // current references; an exam-scoped listing only annotates tags
        // actually used in that exam, so an unused global catalog name
        // (which by definition isn't "in" any one exam) isn't added here.
        else if (!input.examId) combined.set(key, { tag: name, questionCount: 0, registered: true });
      }
      const sorted = [...combined.values()].sort((a, b) => a.tag.localeCompare(b.tag));
      return pageInMemory(sorted, input);
    },

    // --- Question-bank mutations (implementation) --------------------------------
    // Preview (validate) never writes. Every commit method below recomputes
    // proposalToken from the exact target + payload it was given and rejects
    // a mismatch as "conflict" (stale/modified proposal) — see
    // lib/questionProposals.ts. Answer-revision and historical-score
    // preservation come for free from reusing createStatement/updateStatement
    // (lib/questionManagement.ts), unchanged from the Admin REST routes.
    //
    // Every mutation's success audit row is committed in the SAME D1 batch as
    // the mutation itself (create: alongside the insert and idempotency
    // ledger record; update/delete: via buildConditionalAdminMutationAuditStatement,
    // whose outcome/detail are derived from the mutation's own row count via
    // SQLite's changes() rather than decided in JS beforehand) — the two can
    // never diverge, and a genuine SQL error (e.g. duplicate externalId)
    // rolls both back together, falling to a catch block that records the
    // failure separately. Best-effort cache invalidation always runs last,
    // after the audit is already durable, and its failures are swallowed
    // (`.catch(() => {})`, matching touchMcpCredentialLastUsed's use of the
    // same pattern in mcp/routes.ts) — a KV outage must never suppress an
    // already-committed mutation's audit record (both found in review of
    // this PR).
    async validateQuestionPayload(input: { examId: string; id?: string; payload: Record<string, unknown> }) {
      await requireExam(input.examId);
      const row = input.id ? await requireQuestion(input.examId, input.id) : undefined;
      const current = row ? toQuestion(row) : undefined;
      const { payload, issues } = validatePayload(input.payload, current);
      if (issues.length > 0) return { valid: false, issues };
      const result: Record<string, unknown> = { valid: true, issues: [], payload };
      if (current && row) {
        result.currentRevision = row.revision;
        result.answerRevised = answerKey(payloadOf(current)) !== answerKey(payload);
        result.diff = diffPayload(current, payload);
      }
      result.proposalToken = await proposalToken({
        examId: input.examId, questionId: input.id, expectedRevision: row?.revision, payload,
      });
      // A fresh id per preview call — not derived from payload content, unlike
      // proposalToken — so it can serve as admin_create_question's/
      // admin_batch_create_questions' caller-scoped idempotency key: a retry
      // carrying the same proposalId replays the original create instead of
      // inserting a duplicate. Not needed by update/delete, which are already
      // idempotent via expectedRevision.
      result.proposalId = crypto.randomUUID();
      return result;
    },

    async createQuestion(input: {
      examId: string; payload: Record<string, unknown>; proposalToken: string; proposalId: string;
    }) {
      await consumeAdminMutationLimit();
      await requireExam(input.examId);
      const { payload, issues } = validatePayload(input.payload);
      if (issues.length > 0) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const expected = await proposalToken({ examId: input.examId, payload });
      if (expected !== input.proposalToken) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [],
          outcome: "failure", detail: { reason: "stale_proposal" },
        });
        throw new McpApplicationError("conflict");
      }

      // Idempotent replay via a standalone ledger (lib/questionProposals.ts),
      // independent of the questions table so it still recognizes a replay
      // after the created question is later deleted, instead of silently
      // recreating it. proposalToken is the immutable fingerprint of the
      // originally accepted request: reusing proposalId with a *different*
      // one must be rejected, never resolved either as a replay or a new create.
      const existingOperation = await getCreateOperation(db, input.proposalId);
      if (existingOperation) {
        if (existingOperation.proposalToken !== input.proposalToken) {
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_create_question", action: "create", examId: input.examId,
            targetIds: [existingOperation.questionId], outcome: "failure",
            detail: { reason: "proposal_id_reused_with_different_request" },
          });
          throw new McpApplicationError("conflict");
        }
        const existingQuestion = await getQuestionRow(db, existingOperation.examId, existingOperation.questionId);
        return existingQuestion
          ? { question: toQuestion(existingQuestion), idempotentReplay: true }
          : { question: null, idempotentReplay: true, deletedSinceCreation: true };
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      // Resolved before the batch so its link statements commit atomically
      // with the row (implementation review — question_tag_links is
      // authoritative content, not a best-effort side effect). No guard
      // needed: a fresh id has no revision race, and either the whole batch
      // (create, ledger, audit, links) commits together or a thrown error
      // rolls all of it back.
      const desiredTagIds = (await resolveOrCreateTags(db, payload.tags ?? [], now)).map((t) => t.id);
      try {
        // Batched atomically with the ledger record and its own success
        // audit row: either all three commit, or (on a thrown error) none
        // do, so a committed create can never end up missing its ledger
        // entry or audit record.
        await db.batch([
          createStatement(db, input.examId, id, payload, now),
          buildCreateOperationStatement(db, {
            proposalId: input.proposalId, proposalToken: input.proposalToken, examId: input.examId, questionId: id,
          }),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [id],
            // implementation — field names only, never question stem/options/
            // explanation/answer content: the audit log is a persisted
            // logging surface too, not just console/error output.
            outcome: "success", detail: { fields: Object.keys(payload) },
          }),
          ...buildTagLinkStatements(db, id, desiredTagIds, []),
        ]);
      } catch (error) {
        if (String(error).includes("admin_mcp_create_operations")) {
          // Lost a race with a concurrent commit of the same proposalId
          // between the lookup above and this insert; resolve it the same way.
          const raced = await getCreateOperation(db, input.proposalId);
          if (raced && raced.proposalToken === input.proposalToken) {
            const racedQuestion = await getQuestionRow(db, raced.examId, raced.questionId);
            return racedQuestion
              ? { question: toQuestion(racedQuestion), idempotentReplay: true }
              : { question: null, idempotentReplay: true, deletedSinceCreation: true };
          }
        }
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [id],
          outcome: "failure", detail: { reason: String(error).includes("duplicate external ID") ? "duplicate_external_id" : "error" },
        });
        if (String(error).includes("duplicate external ID")) throw new McpApplicationError("conflict");
        throw error;
      }
      await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { question: toQuestion((await getQuestionRow(db, input.examId, id))!) };
    },

    async updateQuestion(input: {
      examId: string; id: string; expectedRevision: number; payload: Record<string, unknown>; proposalToken: string;
    }) {
      await consumeAdminMutationLimit();
      const row = await requireQuestion(input.examId, input.id);
      const current = toQuestion(row);
      const { payload, issues } = validatePayload(input.payload, current);
      if (issues.length > 0) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const expected = await proposalToken({
        examId: input.examId, questionId: input.id, expectedRevision: input.expectedRevision, payload,
      });
      if (expected !== input.proposalToken || input.expectedRevision !== row.revision) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: "stale_proposal" },
        });
        throw new McpApplicationError("conflict");
      }
      const now = new Date().toISOString();
      const diff = diffPayload(current, payload);
      // Resolved before the batch, same reasoning as createQuestion above.
      // The link statements are guarded on the row landing at exactly
      // row.revision + 1 AND this exact `now` (updateStatement's own
      // unconditional `revision = revision + 1, updated_at = ?`) — revision
      // alone isn't enough (see buildTagLinkStatements' own comment: a
      // different concurrent writer could legitimately reach the same
      // revision value) — so a stale-revision write, zero rows changed, not
      // an exception, never still applies a tag-link change alongside it,
      // while a genuine commit applies both together in the same batch.
      const desiredTagIds = (await resolveOrCreateTags(db, payload.tags ?? [], now)).map((t) => t.id);
      const currentTagIds = await fetchTagIdsForQuestions(db, [row.id]).then((m) => m.get(row.id) ?? []);
      const linkStatements = buildTagLinkStatements(db, row.id, desiredTagIds, currentTagIds, { questionId: row.id, revision: row.revision + 1, updatedAt: now });
      let changed: number;
      try {
        const [updateResult] = await db.batch([
          updateStatement(db, row, payload, now),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
            // implementation — changed field names only; diffPayload()'s
            // current/incoming values are full question content and must
            // not be persisted into a routine audit row.
            successDetail: { fields: diff.map((d) => d.field) }, failureDetail: { reason: "stale_revision" },
          }),
          ...linkStatements,
        ]);
        changed = updateResult!.meta.changes;
      } catch (error) {
        // The whole batch (the update, its paired conditional audit row,
        // and the tag-link diff) rolled back together — nothing committed,
        // so record the failure separately.
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: String(error).includes("duplicate external ID") ? "duplicate_external_id" : "error" },
        });
        if (String(error).includes("duplicate external ID")) throw new McpApplicationError("conflict");
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { question: toQuestion((await getQuestionRow(db, input.examId, input.id))!) };
    },

    async deleteQuestion(input: { examId: string; id: string; expectedRevision: number }) {
      await consumeAdminMutationLimit();
      let changed: number;
      try {
        const [deleteResult] = await db.batch([
          db.prepare("DELETE FROM questions WHERE id = ? AND exam_id = ? AND revision = ?")
            .bind(input.id, input.examId, input.expectedRevision),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_delete_question", action: "delete", examId: input.examId, targetIds: [input.id],
            successDetail: {}, failureDetail: { reason: "stale_revision_or_not_found" },
          }),
        ]);
        changed = deleteResult!.meta.changes;
      } catch (error) {
        // The whole batch (the delete and its paired conditional audit row)
        // rolled back together — nothing committed, so record the failure
        // separately.
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_delete_question", action: "delete", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: "dependency_conflict" },
        });
        if (/FOREIGN KEY|question referenced by an attempt/i.test(String(error))) throw new McpApplicationError("conflict");
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { deleted: true };
    },

    async batchCreateQuestions(input: {
      examId: string; items: { payload: Record<string, unknown>; proposalToken: string; proposalId: string }[];
    }) {
      await consumeAdminMutationLimit();
      await requireExam(input.examId);
      if (input.items.length > MAX_BATCH_MUTATION_ITEMS) throw new McpApplicationError("invalid_input");
      const now = new Date().toISOString();

      type Outcome = {
        inputIndex: number; questionId: string; externalId: string | null;
        status: "created" | "skipped" | "failed"; reason?: string; payload?: unknown;
      };
      const outcomes: Outcome[] = new Array(input.items.length);
      // Items resolved without touching the database (idempotent replay, a
      // reused proposalId with different content, invalid payload, stale
      // proposal) are audited unconditionally, in their own batch — an
      // unrelated rollback of the mutation batch below (e.g. a duplicate
      // externalId) must not also erase their audit trail.
      const resolvedAuditStatements: D1PreparedStatement[] = [];
      // Database-bound items become [create, ledger, audit] triples, all
      // committed together — see createQuestion for why the ledger record
      // must be atomic with the insert. `createStatementIndex` records each
      // triple's position for reading back its result after the batch runs.
      const mutationStatements: D1PreparedStatement[] = [];
      const pending: { createStatementIndex: number; inputIndex: number; id: string; externalId: string | null; payload: unknown }[] = [];

      // Bulk-resolve every item's raw (unvalidated) tag names up front —
      // implementation: avoid one resolve per item — then each item's own
      // (unconditional; a fresh id has no revision to race) link
      // statements are pushed into `mutationStatements` alongside its
      // create/ledger/audit triple below, so the whole thing commits or
      // rolls back as one atomic unit instead of a separate best-effort step.
      const rawTagNames = input.items.flatMap((item) => {
        const tags = (item.payload as { tags?: unknown }).tags;
        return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
      });
      const resolveTagIds = await buildTagNameResolver(db, rawTagNames, now);

      const existingOperations = await getCreateOperations(db, input.items.map((item) => item.proposalId));

      for (const [inputIndex, item] of input.items.entries()) {
        const existingOperation = existingOperations.get(item.proposalId);
        if (existingOperation) {
          if (existingOperation.proposalToken !== item.proposalToken) {
            outcomes[inputIndex] = {
              inputIndex, questionId: existingOperation.questionId, externalId: null,
              status: "skipped", reason: "proposal_id_reused_with_different_request",
            };
            resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
              tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
              targetIds: [existingOperation.questionId], outcome: "failure",
              detail: { reason: "proposal_id_reused_with_different_request" },
            }));
            continue;
          }
          const existingQuestion = await getQuestionRow(db, existingOperation.examId, existingOperation.questionId);
          outcomes[inputIndex] = existingQuestion
            ? {
                inputIndex, questionId: existingOperation.questionId, externalId: existingQuestion.external_id,
                status: "created", reason: "idempotent_replay", payload: item.payload,
              }
            : {
                inputIndex, questionId: existingOperation.questionId, externalId: null,
                status: "skipped", reason: "idempotent_replay_deleted_since",
              };
          continue;
        }
        const { payload, issues } = validatePayload(item.payload);
        const id = crypto.randomUUID();
        if (issues.length > 0) {
          outcomes[inputIndex] = { inputIndex, questionId: id, externalId: null, status: "skipped", reason: "invalid" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
            targetIds: [id], outcome: "failure", detail: { reason: "invalid" },
          }));
          continue;
        }
        const expected = await proposalToken({ examId: input.examId, payload });
        if (expected !== item.proposalToken) {
          outcomes[inputIndex] = { inputIndex, questionId: id, externalId: payload.externalId ?? null, status: "skipped", reason: "stale_proposal" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
            targetIds: [id], outcome: "failure", detail: { reason: "stale_proposal" },
          }));
          continue;
        }
        const createStatementIndex = mutationStatements.length;
        mutationStatements.push(createStatement(db, input.examId, id, payload, now));
        mutationStatements.push(buildCreateOperationStatement(db, {
          proposalId: item.proposalId, proposalToken: item.proposalToken, examId: input.examId, questionId: id,
        }));
        mutationStatements.push(buildAdminMutationAuditStatement(db, principal, {
          tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId, targetIds: [id],
          // implementation — field names only; see admin_create_question's audit row.
          outcome: "success", detail: { fields: Object.keys(payload) },
        }));
        mutationStatements.push(...buildTagLinkStatements(db, id, resolveTagIds(payload.tags), []));
        pending.push({ createStatementIndex, inputIndex, id, externalId: payload.externalId ?? null, payload });
      }

      if (resolvedAuditStatements.length > 0) await db.batch(resolvedAuditStatements);

      if (mutationStatements.length > 0) {
        try {
          await db.batch(mutationStatements);
          // createStatement never silently no-ops (see its own doc comment):
          // it either inserts exactly one row or throws, so a batch that
          // didn't throw means every pending item — including its tag
          // links, part of the same batch above — committed.
          for (const p of pending) {
            outcomes[p.inputIndex] = { inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId, status: "created", payload: p.payload };
          }
        } catch {
          // The whole batch (every pending item's create + ledger + audit
          // triple) rolled back together — report each as failed and record
          // one summary failure row for the call.
          for (const p of pending) {
            outcomes[p.inputIndex] = {
              inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId, status: "failed",
              reason: "Batch rolled back; refresh preview and retry.",
            };
          }
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
            targetIds: pending.map((p) => p.id), outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const created = outcomes.filter((o) => o.status === "created").length;
      const skipped = outcomes.filter((o) => o.status === "skipped").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      if (created > 0) await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { outcomes, created, skipped, failed };
    },

    async batchUpdateQuestions(input: {
      examId: string;
      items: { id: string; expectedRevision: number; proposalToken: string; payload: Record<string, unknown> }[];
    }) {
      await consumeAdminMutationLimit();
      await requireExam(input.examId);
      if (input.items.length > MAX_BATCH_MUTATION_ITEMS) throw new McpApplicationError("invalid_input");
      const now = new Date().toISOString();

      type Outcome = {
        inputIndex: number; questionId: string; externalId: string | null;
        status: "updated" | "skipped" | "failed"; reason?: string; diff?: PayloadDifference[];
      };
      const outcomes: Outcome[] = new Array(input.items.length);
      // Same split as batchCreateQuestions: items resolved without touching
      // the database are audited unconditionally, in their own batch, so an
      // unrelated rollback of the mutation batch below can't erase them.
      const resolvedAuditStatements: D1PreparedStatement[] = [];
      // Database-bound items become [update, conditionalAudit] pairs — see
      // updateQuestion for why the audit outcome/detail must be derived from
      // the update's own row count (via changes()) rather than assumed.
      const mutationStatements: D1PreparedStatement[] = [];
      const pending: {
        updateStatementIndex: number; inputIndex: number; id: string; externalId: string | null; diff: PayloadDifference[];
      }[] = [];

      // Bulk-resolve every item's tag names up front (implementation — avoid one
      // resolve per item) using the raw, unvalidated payloads; resolving a
      // name that later turns out to belong to an invalid/skipped item is
      // harmless (same as import's bulk resolve — see routes/imports.ts).
      const rawTagNames = input.items.flatMap((item) => {
        const tags = (item.payload as { tags?: unknown }).tags;
        return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
      });
      const resolveTagIds = await buildTagNameResolver(db, rawTagNames, now);
      const currentTagIdsByQuestion = await fetchTagIdsForQuestions(db, input.items.map((item) => item.id));

      for (const [inputIndex, item] of input.items.entries()) {
        const row = await getQuestionRow(db, input.examId, item.id);
        if (!row) {
          outcomes[inputIndex] = { inputIndex, questionId: item.id, externalId: null, status: "skipped", reason: "not_found" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: [item.id], outcome: "failure", detail: { reason: "not_found" },
          }));
          continue;
        }
        const current = toQuestion(row);
        const { payload, issues } = validatePayload(item.payload, current);
        if (issues.length > 0) {
          outcomes[inputIndex] = { inputIndex, questionId: row.id, externalId: row.external_id, status: "skipped", reason: "invalid" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: [row.id], outcome: "failure", detail: { reason: "invalid" },
          }));
          continue;
        }
        const expected = await proposalToken({
          examId: input.examId, questionId: item.id, expectedRevision: item.expectedRevision, payload,
        });
        if (expected !== item.proposalToken || item.expectedRevision !== row.revision) {
          outcomes[inputIndex] = { inputIndex, questionId: row.id, externalId: row.external_id, status: "skipped", reason: "stale_proposal" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: [row.id], outcome: "failure", detail: { reason: "stale_proposal" },
          }));
          continue;
        }
        const diff = diffPayload(current, payload);
        const updateStatementIndex = mutationStatements.length;
        mutationStatements.push(updateStatement(db, row, payload, now));
        mutationStatements.push(buildConditionalAdminMutationAuditStatement(db, principal, {
          tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId, targetIds: [row.id],
          // implementation — field names only; see admin_update_question's audit row.
          successDetail: { fields: diff.map((d) => d.field) }, failureDetail: { reason: "stale_revision" },
        }));
        // Guarded on the row landing at exactly row.revision + 1 AND this
        // exact `now` — revision alone isn't enough (see
        // buildTagLinkStatements: a different concurrent writer could
        // legitimately reach the same revision value) — so this item's own
        // stale-revision no-op (0 rows changed, not an exception — the
        // whole batch below still "succeeds") never still applies a
        // tag-link change: it commits atomically with the update above, in
        // the SAME batch, not as a separate best-effort step.
        mutationStatements.push(...buildTagLinkStatements(
          db, row.id, resolveTagIds(payload.tags), currentTagIdsByQuestion.get(row.id) ?? [],
          { questionId: row.id, revision: row.revision + 1, updatedAt: now },
        ));
        pending.push({ updateStatementIndex, inputIndex, id: row.id, externalId: row.external_id, diff });
      }

      if (resolvedAuditStatements.length > 0) await db.batch(resolvedAuditStatements);

      if (mutationStatements.length > 0) {
        try {
          const results = await db.batch(mutationStatements);
          for (const p of pending) {
            const changed = results[p.updateStatementIndex]!.meta.changes > 0;
            outcomes[p.inputIndex] = {
              inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId,
              status: changed ? "updated" : "skipped",
              reason: changed ? undefined : "stale_question; refresh preview",
              diff: changed ? p.diff : undefined,
            };
          }
        } catch {
          for (const p of pending) {
            outcomes[p.inputIndex] = {
              inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId, status: "failed",
              reason: "Batch rolled back; refresh preview and retry.",
            };
          }
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: pending.map((p) => p.id), outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const updated = outcomes.filter((o) => o.status === "updated").length;
      const skipped = outcomes.filter((o) => o.status === "skipped").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      if (updated > 0) await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { outcomes, updated, skipped, failed };
    },

    // --- Exam lifecycle (implementation) -------------------------------------------
    // No proposalToken/expectedRevision — exams have no `revision` column and
    // REST doesn't have one either; not inventing new concurrency control
    // beyond what already exists.
    async createExam(input: ExamCreateFields) {
      await consumeAdminMutationLimit();
      if (!EXAM_SLUG_PATTERN.test(input.slug)) throw new McpApplicationError("invalid_input");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await db.batch([
          createExamStatement(db, id, input, now),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_create_exam", action: "exam_create", examId: id, targetIds: [id],
            outcome: "success", detail: { slug: input.slug, name: input.name },
          }),
        ]);
      } catch {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_exam", action: "exam_create", examId: null, targetIds: [],
          outcome: "failure", detail: { reason: "slug_taken" },
        });
        throw new McpApplicationError("conflict");
      }
      return { exam: (await getExamRecord(db, id))! };
    },

    async updateExam(input: { id: string } & ExamMutableFields) {
      await consumeAdminMutationLimit();
      const { id, ...fields } = input;
      if (fields.slug !== undefined && !EXAM_SLUG_PATTERN.test(fields.slug)) throw new McpApplicationError("invalid_input");
      const statement = updateExamStatement(db, id, fields);
      if (!statement) throw new McpApplicationError("invalid_input");
      let changed: number;
      try {
        const [result] = await db.batch([
          statement,
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_update_exam", action: "exam_update", examId: id, targetIds: [id],
            successDetail: { fields }, failureDetail: { reason: "not_found" },
          }),
        ]);
        changed = result!.meta.changes;
      } catch {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_exam", action: "exam_update", examId: id, targetIds: [id],
          outcome: "failure", detail: { reason: "slug_taken" },
        });
        throw new McpApplicationError("conflict");
      }
      if (!changed) throw new McpApplicationError("not_found");
      return { exam: (await getExamRecord(db, id))! };
    },

    async archiveExam(input: { id: string }) {
      await consumeAdminMutationLimit();
      const now = new Date().toISOString();
      let changed: number;
      try {
        const [result] = await db.batch([
          archiveExamStatement(db, input.id, now),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_archive_exam", action: "exam_archive", examId: input.id, targetIds: [input.id],
            successDetail: { archivedAt: now }, failureDetail: { reason: "already_archived_or_not_found" },
          }),
        ]);
        changed = result!.meta.changes;
      } catch (error) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_archive_exam", action: "exam_archive", examId: input.id, targetIds: [input.id],
          outcome: "failure", detail: { reason: "error" },
        });
        throw error;
      }
      if (!changed) {
        const exists = await examExists(db, input.id);
        throw new McpApplicationError(exists ? "conflict" : "not_found");
      }
      return { archivedAt: now };
    },

    // --- Import workflow (implementation) ------------------------------------------
    // Reuses lib/importConflicts.ts's re-import preservation rules and
    // lib/importExecution.ts's classification, unchanged from REST (see
    // routes/imports.ts). Preview never writes to D1. Execute binds to the
    // exact reviewed file via fileToken and to the exact reviewed
    // conflictResolutions via requestFingerprint, and claims `importId`
    // atomically in admin_mcp_import_jobs (claimImportJob, above) so a
    // concurrent or replayed execute can't double-apply or silently diverge
    // from what was reviewed.
    async exportQuestions(input: { examId: string; limit?: number; offset?: number }) {
      await requireExam(input.examId);
      const result = await searchQuestionsQuery(db, input.examId, { limit: input.limit ?? 50, offset: input.offset ?? 0 });
      if (!result.questions.length) throw new McpApplicationError("not_found");
      const exam = (await getExamRecord(db, input.examId))!;
      let file;
      try { file = exportComponentPackage({ id: exam.id, name: exam.name }, result.questions.map(q => ({ ...q, externalId: q.externalId ?? q.id, options: q.options ?? undefined }))); }
      catch { throw new McpApplicationError("conflict"); }
      return { file,
        total: result.total, offset: result.offset, nextOffset: result.offset + result.questions.length < result.total ? result.offset + result.questions.length : null };
    },

    async validateImport(input: { examId: string; file: unknown }) {
      await consumeImportRateLimit("validate", input.examId);
      await requireExam(input.examId);
      assertImportFileDepth(input.file);
      const { issues, duplicateExternalIdsInFile, questionCount } = validateImportFileContents(input.file);
      return { valid: issues.length === 0, questionCount, issues, duplicateExternalIdsInFile };
    },

    async previewImport(input: { examId: string; file: unknown }) {
      await consumeImportRateLimit("validate", input.examId);
      await requireExam(input.examId);
      assertImportFileDepth(input.file);
      const { issues, duplicateExternalIdsInFile, questionCount } = validateImportFileContents(input.file);
      if (issues.length > 0) {
        return {
          importId: null, importToken: null, valid: false, questionCount, issues, duplicateExternalIdsInFile,
          duplicateExternalIdsInDb: [], creates: [], updates: [], skips: [], conflicts: [],
        };
      }
      const file = normalizeImportFile(input.file);
      const externalIds = file.questions.map((q) => q.externalId).filter((x): x is string => !!x);
      const existing = externalIds.length ? await findQuestionRowsByExternalId(db, input.examId, externalIds) : [];
      const duplicateExternalIdsInDb = [...new Set(existing.map((r) => r.external_id!).filter(Boolean))];
      const classification = await classifyImportRows(db, existing, file.questions);
      // Snapshots what every tag name in the file currently resolves to
      // (read-only) and binds it into importToken alongside the file
      // content, so a taxonomy change before execute (a rename/merge that
      // changes what an unchanged name would now resolve to) is detected as
      // a stale proposal instead of silently committing a different tag
      // identity than the one reviewed here — see fileToken's own comment.
      const tagSnapshot = await tagResolutionSnapshot(db, file.questions.flatMap((q) => q.tags ?? []));
      return {
        importId: crypto.randomUUID(),
        importToken: await computeFileToken(input.examId, input.file, tagSnapshot),
        valid: true, questionCount, duplicateExternalIdsInFile, duplicateExternalIdsInDb,
        creates: classification.creates, updates: classification.updates,
        skips: classification.skips, conflicts: classification.conflicts,
      };
    },

    async executeImport(input: {
      examId: string; file: unknown; importId: string; importToken: string;
      conflictResolutions?: ImportConflictResolution[];
    }) {
      await consumeImportRateLimit("execute", input.examId);
      await requireExam(input.examId);
      assertImportFileDepth(input.file);

      // Re-resolved against CURRENT catalog state (not the preview-time
      // state) — a mismatch against input.importToken below means either
      // the file changed OR the taxonomy did (see fileToken's comment).
      const executeTimeTagSnapshot = await tagResolutionSnapshot(db, (input.file as { questions?: { tags?: string[] }[] }).questions?.flatMap((q) => q.tags ?? []) ?? []);
      const computedFileToken = await computeFileToken(input.examId, input.file, executeTimeTagSnapshot);
      if (computedFileToken !== input.importToken) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
          outcome: "failure", detail: { reason: "stale_proposal" },
        });
        throw new McpApplicationError("conflict");
      }

      const { issues, questionCount } = validateImportFileContents(input.file);
      if (issues.length > 0) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const file = normalizeImportFile(input.file);
      const resolutions = input.conflictResolutions ?? [];
      const fingerprint = await computeRequestFingerprint(computedFileToken, resolutions);

      const { resuming, row: jobRow } = await claimImportJob({
        importId: input.importId, examId: input.examId, fileTok: computedFileToken, fingerprint, questionCount,
      });
      if (jobRow.status !== "in_progress") {
        return { importId: input.importId, idempotentReplay: true, ...(jobRow.result_json ? JSON.parse(jobRow.result_json) : {}) };
      }

      const now = new Date().toISOString();
      let r2Key = jobRow.r2_object_key;
      if (!r2Key) {
        r2Key = `imports/${input.examId}/${Date.now()}-${crypto.randomUUID()}.json`;
        try {
          await env.BUCKET.put(r2Key, JSON.stringify(input.file), { httpMetadata: { contentType: "application/json" } });
        } catch {
          if (!resuming) await db.prepare("DELETE FROM admin_mcp_import_jobs WHERE id = ?").bind(input.importId).run();
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
            outcome: "failure", detail: { reason: "archive_failed" },
          });
          throw new McpApplicationError("internal");
        }
        // No executionCtx.waitUntil is available at this layer (unlike the
        // Hono routes), so this runs inline rather than backgrounded like
        // REST's equivalent — same retention behavior, slightly more latency
        // on the call that happens to write a fresh archive.
        await cleanOldImportArchives(env.BUCKET, input.examId, r2Key).catch(() => {});
        await db.prepare("UPDATE admin_mcp_import_jobs SET r2_object_key = ?, updated_at = ? WHERE id = ?")
          .bind(r2Key, Date.now(), input.importId).run();
      }

      const externalIds = file.questions.map((q) => q.externalId).filter((x): x is string => !!x);
      const existingRows = externalIds.length ? await findQuestionRowsByExternalId(db, input.examId, externalIds) : [];
      const classification = await classifyImportRows(db, existingRows, file.questions);
      const resolutionByQuestion = new Map(resolutions.map((r) => [r.questionId, r]));
      // Bulk-resolve every distinct tag name in the file once (implementation),
      // rather than once per created/updated row below.
      const resolveTagIds = await buildTagNameResolver(db, file.questions.flatMap((q) => q.tags ?? []), now);

      type ExecuteOutcome = {
        index: number; questionId: string; externalId: string | null;
        status: "created" | "updated" | "skipped" | "conflict" | "failed"; reason?: string;
      };
      const outcomes: ExecuteOutcome[] = [];
      const pendingApplies: { index: number; row: QuestionRow }[] = [];

      // implementation (review round 2) — recover what a PRIOR attempt of this
      // exact importId already committed before reclassifying anything.
      // Without this, re-running classifyImportRows against current DB state
      // makes an already-applied create/update look "identical" to its
      // incoming payload and reclassifies it as a plain skip — silently
      // losing track of it in this attempt's created/updated counts (and
      // therefore in the final result and cache-invalidation decision).
      // Indices recorded here are excluded from every classification bucket
      // below and never reprocessed.
      const alreadyCommitted = await getCommittedImportItems(db, input.importId);
      for (const item of alreadyCommitted.values()) {
        outcomes.push({ index: item.itemIndex, questionId: item.questionId, externalId: item.externalId, status: item.kind });
      }

      // Matches REST's exact rule (routes/imports.ts): ANY non-identical row
      // — whether classifyImportRows called it a candidate "update" or a
      // "conflict" — needs an explicit, exactly-matching resolution to be
      // applied. Ambiguous external ids are never resolvable at all.
      const needsResolution = [
        ...classification.updates.map((u) => ({ ...u, ambiguous: false as const, reason: undefined as string | undefined })),
        ...classification.conflicts.map((c) => ({
          index: c.index, questionId: c.questionId, externalId: c.externalId,
          expectedRevision: c.expectedRevision, incomingToken: c.incomingToken,
          reason: c.reason as string | undefined, ambiguous: c.reason === "ambiguous_external_id",
        })),
      ];
      for (const item of needsResolution) {
        if (alreadyCommitted.has(item.index)) continue;
        if (item.ambiguous) {
          outcomes.push({ index: item.index, questionId: item.questionId, externalId: item.externalId, status: "conflict", reason: "ambiguous_external_id" });
          continue;
        }
        const resolution = resolutionByQuestion.get(item.questionId);
        const valid = resolution && resolution.expectedRevision === item.expectedRevision && resolution.incomingToken === item.incomingToken;
        if (!valid) {
          outcomes.push({ index: item.index, questionId: item.questionId, externalId: item.externalId, status: "conflict", reason: item.reason ?? "incoming_changes" });
          continue;
        }
        if (resolution!.action === "keep") {
          outcomes.push({ index: item.index, questionId: item.questionId, externalId: item.externalId, status: "skipped", reason: "kept_current" });
          continue;
        }
        const row = existingRows.find((r) => r.id === item.questionId)!;
        pendingApplies.push({ index: item.index, row });
      }
      for (const skip of classification.skips) {
        if (alreadyCommitted.has(skip.index)) continue;
        outcomes.push({ index: skip.index, questionId: skip.questionId, externalId: skip.externalId, status: "skipped", reason: skip.reason });
      }

      // Resume-safety for creates now lives entirely in the pre-filter above
      // (alreadyCommitted), backed by admin_mcp_import_committed_items
      // (migration 0024) rather than implementation's admin_mcp_create_operations —
      // that ledger stays reserved for admin_create_question/
      // admin_batch_create_questions' own idempotency, unrelated to imports.
      const creates = classification.creates.filter((c) => !alreadyCommitted.has(c.index));

      // Chunked by item count for import-execute-specific reasons (bounded
      // per-attempt commit size, not a hard D1 statement-count limit —
      // admin_batch_create_questions/admin_batch_update_questions already
      // run well past 50 statements in a single db.batch() without issue).
      // Each item's tag-link statements are pushed into the SAME chunk
      // `statements` array as its row write, so both commit or roll back
      // together (implementation review — question_tag_links is authoritative
      // content, not a best-effort side effect).
      for (let start = 0; start < creates.length; start += 16) {
        const chunk = creates.slice(start, start + 16);
        const statements: D1PreparedStatement[] = [];
        const meta: { index: number; id: string; externalId: string | null }[] = [];
        for (const c of chunk) {
          const q = file.questions[c.index]!;
          const id = crypto.randomUUID();
          const tagIds = resolveTagIds(q.tags);
          // imported=true records import_baseline_json (and, alongside it,
          // the resolved tagIds as import_baseline_tag_ids_json — see
          // lib/importConflicts.ts), matching REST's execute route —
          // without it, a *future* re-import of this same externalId could
          // never distinguish "locally edited since" from "safe incoming
          // change".
          statements.push(createStatement(db, input.examId, id, q, now, true, tagIds));
          statements.push(buildCommittedImportItemStatement(db, {
            importId: input.importId, itemIndex: c.index, questionId: id, examId: input.examId, externalId: c.externalId, kind: "created",
          }));
          statements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [id],
            outcome: "success", detail: { importId: input.importId, externalId: c.externalId },
          }));
          // A fresh id has no revision to race — unconditional, same as
          // createQuestion/admin_batch_create_questions.
          statements.push(...buildTagLinkStatements(db, id, tagIds, []));
          meta.push({ index: c.index, id, externalId: c.externalId });
        }
        if (statements.length === 0) continue;
        try {
          await db.batch(statements);
          for (const m of meta) outcomes.push({ index: m.index, questionId: m.id, externalId: m.externalId, status: "created" });
        } catch {
          for (const m of meta) outcomes.push({ index: m.index, questionId: m.id, externalId: m.externalId, status: "failed", reason: "batch_rolled_back" });
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: meta.map((m) => m.id),
            outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const currentTagIdsByQuestion = await fetchTagIdsForQuestions(db, pendingApplies.map((a) => a.row.id));
      for (let start = 0; start < pendingApplies.length; start += 16) {
        const chunk = pendingApplies.slice(start, start + 16);
        const statements: D1PreparedStatement[] = [];
        // `updateStatementIndex` replaces the old fixed `i * 3` arithmetic:
        // each item now carries a variable number of trailing tag-link
        // statements (see below), so its primary update statement's
        // position must be tracked explicitly rather than assumed.
        const meta: { index: number; questionId: string; externalId: string | null; updateStatementIndex: number }[] = [];
        for (const a of chunk) {
          const q = file.questions[a.index]!;
          const tagIds = resolveTagIds(q.tags);
          const updateStatementIndex = statements.length;
          // Order matters: buildConditionalCommittedImportItemStatement reads
          // changes() from THIS updateStatement, and the audit statement
          // after it reads changes() from the committed-item insert in turn
          // (verified: a 0-row conditional INSERT still sets changes()=0,
          // propagating a stale-revision "no" through the whole chain). The
          // tag-link statements below go AFTER both — nothing may run
          // between updateStatement and its two dependent changes()-chained
          // statements.
          statements.push(updateStatement(db, a.row, q, now, true, tagIds));
          statements.push(buildConditionalCommittedImportItemStatement(db, {
            importId: input.importId, itemIndex: a.index, questionId: a.row.id, examId: input.examId,
            externalId: a.row.external_id, kind: "updated",
          }));
          statements.push(buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [a.row.id],
            successDetail: { importId: input.importId }, failureDetail: { reason: "stale_question" },
          }));
          // Guarded on the row's own post-update revision AND `now` (rather
          // than relying on changes()-chaining, which only reflects the
          // single immediately-preceding statement, or on revision alone —
          // see buildTagLinkStatements: a different concurrent writer could
          // legitimately reach the same revision value) — a stale-revision
          // update that changed zero rows leaves the row's revision and
          // updated_at unchanged, so this guard fails closed, in the SAME
          // batch as the update itself rather than a separate best-effort
          // step (implementation review).
          statements.push(...buildTagLinkStatements(
            db, a.row.id, tagIds, currentTagIdsByQuestion.get(a.row.id) ?? [],
            { questionId: a.row.id, revision: a.row.revision + 1, updatedAt: now },
          ));
          meta.push({ index: a.index, questionId: a.row.id, externalId: a.row.external_id, updateStatementIndex });
        }
        try {
          const results = await db.batch(statements);
          meta.forEach((m) => {
            const changed = results[m.updateStatementIndex]!.meta.changes > 0;
            outcomes.push({
              index: m.index, questionId: m.questionId, externalId: m.externalId,
              status: changed ? "updated" : "conflict", reason: changed ? undefined : "stale_question; refresh preview",
            });
          });
        } catch {
          meta.forEach((m) => outcomes.push({ index: m.index, questionId: m.questionId, externalId: m.externalId, status: "failed", reason: "batch_rolled_back" }));
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: meta.map((m) => m.questionId),
            outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const created = outcomes.filter((o) => o.status === "created").length;
      const updated = outcomes.filter((o) => o.status === "updated").length;
      const skipped = outcomes.filter((o) => o.status === "skipped" || o.status === "conflict").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      const status: "completed" | "partial" | "failed" = failed === 0 ? "completed" : (created + updated > 0 ? "partial" : "failed");

      // Lean summary only — no payload content/differences, so this table
      // doesn't duplicate content outside R2's archive/retention policy.
      const leanOutcomes = outcomes.map((o) => ({ questionId: o.questionId, externalId: o.externalId, status: o.status, reason: o.reason }));
      const resultSummary = { total: file.questions.length, created, updated, skipped, failed, outcomes: leanOutcomes };
      const completedAtMs = Date.now();
      await db.prepare(
        `UPDATE admin_mcp_import_jobs SET status = ?, created_count = ?, updated_count = ?, skipped_count = ?, failed_count = ?,
           result_json = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(status, created, updated, skipped, failed, JSON.stringify(resultSummary), completedAtMs, completedAtMs, input.importId).run();

      // Same table REST writes, so MCP-originated imports appear in the
      // existing GET /logs history.
      const importLogId = crypto.randomUUID();
      await db.prepare(
        "INSERT INTO import_logs (id, exam_id, uploaded_by, r2_object_key, question_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(importLogId, input.examId, principal.userId, r2Key, file.questions.length, now).run();

      if (created > 0 || updated > 0) await invalidatePracticeQuestions(env, input.examId).catch(() => {});

      return { importId: input.importId, total: file.questions.length, created, updated, skipped, failed, outcomes: leanOutcomes };
    },

    async getImportStatus(input: { importId: string }) {
      const row = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").bind(input.importId).first<ImportJobRow>();
      if (!row) throw new McpApplicationError("not_found");
      return {
        importId: row.id, examId: row.exam_id, status: row.status, questionCount: row.question_count,
        createdCount: row.created_count, updatedCount: row.updated_count,
        skippedCount: row.skipped_count, failedCount: row.failed_count,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
      };
    },

    // --- Taxonomy (implementation) --------------------------------------------------
    // Tool inputs are plain tag-name strings throughout — no client-visible
    // catalog ids (implementation's original contract, unchanged) — but rename/merge
    // are now PURE catalog + question_tag_links operations: a tag's id (and
    // therefore every link pointing at it) never changes on a rename, and a
    // merge only ever reassigns/removes links and deletes source catalog
    // rows. Neither ever touches a `questions` row, so unlike implementation's original
    // per-row tags_json rewrite there is no affected-question-count this can
    // fail against, no chunking, and no per-row conflict/retry bookkeeping —
    // `conflicts` stays in the response shape (always empty) only so
    // existing callers don't have to branch on its absence.
    async createTag(input: { name: string }) {
      await consumeAdminMutationLimit();
      const name = normalizeTagName(input.name);
      if (!name) throw new McpApplicationError("invalid_input");
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await db.batch([
          registerTagCatalogStatement(db, id, name, now),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_create_tag", action: "tag_create", examId: null, targetIds: [id], outcome: "success", detail: { name },
          }),
        ]);
      } catch {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_tag", action: "tag_create", examId: null, targetIds: [], outcome: "failure", detail: { reason: "already_exists", name },
        });
        throw new McpApplicationError("conflict");
      }
      return { id, name };
    },

    // `affectedQuestionCount` is now purely informational (how many
    // questions currently carry the tag) — renaming never rewrites or
    // revision-bumps any of them. The rename itself is guarded by a
    // read-then-write revision compare-and-swap on the catalog row, so a
    // concurrent rename/merge of the SAME tag between this call's read and
    // write is reported as a conflict rather than silently lost.
    async updateTag(input: { name: string; newName: string }) {
      await consumeAdminMutationLimit();
      const name = normalizeTagName(input.name);
      const newName = normalizeTagName(input.newName);
      if (!name || !newName) throw new McpApplicationError("invalid_input");
      const existingSource = await findTagCatalogRowByName(db, name);
      if (!existingSource) throw new McpApplicationError("not_found");
      if (name.toLowerCase() !== newName.toLowerCase()) {
        const collision = await findTagCatalogRowByName(db, newName);
        if (collision && collision.id !== existingSource.id) throw new McpApplicationError("conflict");
      }
      const now = new Date().toISOString();
      const affectedQuestionCount = await countQuestionsForTag(db, existingSource.id);
      let changed: number;
      try {
        const [result] = await db.batch([
          renameTagCatalogStatement(db, existingSource.id, existingSource.revision, newName, now),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_update_tag", action: "tag_update", examId: null, targetIds: [existingSource.id],
            successDetail: { name, newName, affectedQuestionCount }, failureDetail: { reason: "stale_revision" },
          }),
        ]);
        changed = result!.meta.changes;
      } catch (error) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_tag", action: "tag_update", examId: null, targetIds: [existingSource.id],
          outcome: "failure", detail: { reason: "error" },
        });
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      // No question row changed, so there's nothing for updateStatement's
      // own cache invalidation to have caught — but the renamed display
      // name is embedded in every affected exam's cached practice catalog
      // (routes/practice.ts), so that cache still needs invalidating.
      const examIds = await distinctExamIdsForTags(db, [existingSource.id]);
      await Promise.all(examIds.map((examId) => invalidatePracticeQuestions(env, examId).catch(() => {})));
      return { name: newName, affectedQuestionCount, conflicts: [] };
    },

    // `affectedQuestionCount` counts DISTINCT questions across every source
    // tag (a question carrying two merged-away tags counts once). The whole
    // operation — touching/registering the target, reassigning every
    // source's links, and deleting every source catalog row — is one atomic
    // batch: reassign/delete are each guarded on the target row still being
    // at its just-touched revision, so a lost concurrent race on the target
    // (touchTagCatalogStatement's own compare-and-swap) leaves every
    // guarded statement a no-op instead of partially merging.
    async mergeTags(input: { names: string[]; targetName: string }) {
      await consumeAdminMutationLimit();
      const targetName = normalizeTagName(input.targetName);
      if (!targetName || input.names.length === 0) throw new McpApplicationError("invalid_input");
      const sourceNames = [...new Set(input.names.map((n) => normalizeTagName(n)).filter((n): n is string => !!n))]
        .filter((n) => n.toLowerCase() !== targetName.toLowerCase());
      if (sourceNames.length === 0 || sourceNames.length > MAX_MERGE_SOURCE_TAGS) throw new McpApplicationError("invalid_input");

      const now = new Date().toISOString();
      const existingTarget = await findTagCatalogRowByName(db, targetName);
      const sourceRows = (await Promise.all(sourceNames.map((n) => findTagCatalogRowByName(db, n))))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const affectedQuestionCount = await countQuestionsForAnyTag(db, sourceRows.map((r) => r.id));
      // Computed BEFORE the batch below reassigns/deletes source links —
      // afterward, the source ids no longer resolve to any link at all.
      const examIdsToInvalidate = await distinctExamIdsForTags(
        db, [...(existingTarget ? [existingTarget.id] : []), ...sourceRows.map((r) => r.id)],
      );

      const targetId = existingTarget?.id ?? crypto.randomUUID();
      // Folds "no source has drifted since it was read above" into the
      // SAME compare-and-swap that already guards the target — see
      // sourceDriftCondition's own comment for why a per-source guard
      // (rather than each reassign/delete statement independently) is what
      // makes the whole merge abort atomically instead of partially
      // completing around a concurrently-edited source.
      const driftGuard = sourceDriftCondition(sourceRows.map((r) => ({ id: r.id, revision: r.revision })));
      const touchOrRegister = existingTarget
        ? touchTagCatalogStatement(db, existingTarget.id, existingTarget.revision, now, driftGuard)
        : registerTagCatalogStatement(db, targetId, targetName, now, driftGuard);
      const targetRevisionAfter = (existingTarget?.revision ?? 0) + 1;
      const guard = { tagId: targetId, revision: targetRevisionAfter, updatedAt: now };
      const statements = [
        touchOrRegister,
        buildConditionalAdminMutationAuditStatement(db, principal, {
          tool: "admin_merge_tags", action: "tag_merge", examId: null, targetIds: [targetId, ...sourceRows.map((r) => r.id)],
          successDetail: { names: sourceNames, targetName, affectedQuestionCount }, failureDetail: { reason: "stale_revision" },
        }),
        // Baselines track tag identity too. Remap the saved import snapshot
        // with the live links so a catalog merge cannot invent a local edit.
        //
        // This is the one part of a merge that reads question rows at all, and
        // it has no index-usable predicate — so `import_baseline_tag_ids_json
        // IS NOT NULL` leads the WHERE deliberately: it is a cheap column test
        // that lets every never-imported question fall out before the much more
        // expensive json_each() is evaluated over its baseline. Without it this
        // statement expands a JSON array per row of `questions`, inside the
        // merge's own atomic batch. (implementation removed the implementation-era 500-question
        // rewrite cap on merges; that is about rewriting rows, which this still
        // does not do for anything outside the merged tags.)
        db.prepare(
          `UPDATE questions SET import_baseline_tag_ids_json = (
             SELECT json_group_array(tag_id) FROM (
               SELECT DISTINCT CASE WHEN value IN (SELECT value FROM json_each(?)) THEN ? ELSE value END AS tag_id
               FROM json_each(questions.import_baseline_tag_ids_json) ORDER BY tag_id
             )
           ) WHERE import_baseline_tag_ids_json IS NOT NULL AND EXISTS (
             SELECT 1 FROM json_each(questions.import_baseline_tag_ids_json)
             WHERE value IN (SELECT value FROM json_each(?))
           ) AND EXISTS (SELECT 1 FROM question_bank_tags WHERE id = ? AND revision = ? AND updated_at = ?)`
        ).bind(JSON.stringify(sourceRows.map((r) => r.id)), targetId,
          JSON.stringify(sourceRows.map((r) => r.id)), targetId, targetRevisionAfter, now),
        // Guarded unconditionally (not just when the target pre-existed):
        // for a brand-new target this checks it landed at revision 1 (the
        // INSERT's own hardcoded value), which is equally false if the
        // conditional INSERT above didn't fire due to source drift.
        ...sourceRows.flatMap((source) => [
          reassignTagLinksStatement(db, source.id, targetId, guard),
          deleteTagCatalogByIdStatement(db, source.id, guard),
        ]),
      ];
      let changed: number;
      try {
        const [result] = await db.batch(statements);
        changed = result!.meta.changes;
      } catch (error) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_merge_tags", action: "tag_merge", examId: null, targetIds: [targetId],
          outcome: "failure", detail: { reason: "error" },
        });
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      await Promise.all(examIdsToInvalidate.map((examId) => invalidatePracticeQuestions(env, examId).catch(() => {})));
      return { name: targetName, mergedNames: sourceNames, affectedQuestionCount, conflicts: [] };
    },
  });
}

function scanMeta(scannedCount: number) {
  return { scannedCount, truncated: scannedCount >= EXAM_QUESTION_SCAN_LIMIT };
}
