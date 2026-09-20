// implementation — stateless propose-then-commit binding for Admin MCP question
// mutations, generalizing the sha256-token trick lib/importConflicts.ts
// already uses for re-import conflicts: hash the exact reviewed target +
// payload, and require the commit call to reproduce that hash before writing.
// No server-side proposal storage is needed — a mismatch just means "the
// payload, question, or expected revision changed since preview; refresh it."
import { canonical, editableFields, payloadOf, type QuestionPayload } from "./questionManagement";
import type { Question } from "@prepdeck/shared";

export interface ProposalTarget {
  examId: string;
  questionId?: string;
  expectedRevision?: number;
  payload: QuestionPayload;
}

export async function proposalToken(target: ProposalTarget): Promise<string> {
  const material = JSON.stringify([
    target.examId,
    target.questionId ?? null,
    target.expectedRevision ?? null,
    canonical(target.payload),
  ]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PayloadDifference {
  field: (typeof editableFields)[number];
  current: unknown;
  incoming: unknown;
}

export function diffPayload(current: Question | QuestionPayload, next: Question | QuestionPayload): PayloadDifference[] {
  const before = payloadOf(current);
  const after = payloadOf(next);
  return editableFields
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, current: before[field] ?? null, incoming: after[field] ?? null }));
}

// implementation (review) — a standalone idempotency ledger for admin_create_question
// and admin_batch_create_questions, independent of the questions table so a
// replay after the created question is deleted is still recognized instead
// of silently recreating it (migrations/0020_admin_mcp_create_idempotency.sql).
// proposalToken is the immutable fingerprint of the originally accepted
// request (it already binds examId + payload); a replay whose proposalToken
// doesn't match the stored one means the proposalId is being reused with
// different content, and must be rejected rather than resolved either way.
export interface CreateOperationRecord {
  proposalId: string;
  proposalToken: string;
  examId: string;
  questionId: string;
}

interface CreateOperationRow {
  proposal_id: string;
  proposal_token: string;
  exam_id: string;
  question_id: string;
}

function toCreateOperationRecord(row: CreateOperationRow): CreateOperationRecord {
  return { proposalId: row.proposal_id, proposalToken: row.proposal_token, examId: row.exam_id, questionId: row.question_id };
}

export function buildCreateOperationStatement(db: D1Database, record: CreateOperationRecord): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO admin_mcp_create_operations (proposal_id, proposal_token, exam_id, question_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(record.proposalId, record.proposalToken, record.examId, record.questionId, Date.now());
}

export async function getCreateOperation(db: D1Database, proposalId: string): Promise<CreateOperationRecord | null> {
  const row = await db.prepare(
    "SELECT proposal_id, proposal_token, exam_id, question_id FROM admin_mcp_create_operations WHERE proposal_id = ?",
  ).bind(proposalId).first<CreateOperationRow>();
  return row ? toCreateOperationRecord(row) : null;
}

// Bulk variant for admin_batch_create_questions, so a batch of retried items
// can be resolved with one query instead of one per item.
export async function getCreateOperations(db: D1Database, proposalIds: string[]): Promise<Map<string, CreateOperationRecord>> {
  if (proposalIds.length === 0) return new Map();
  const placeholders = proposalIds.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT proposal_id, proposal_token, exam_id, question_id FROM admin_mcp_create_operations WHERE proposal_id IN (${placeholders})`,
  ).bind(...proposalIds).all<CreateOperationRow>();
  return new Map((results ?? []).map((row) => [row.proposal_id, toCreateOperationRecord(row)]));
}
