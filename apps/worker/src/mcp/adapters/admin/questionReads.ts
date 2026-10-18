import { McpApplicationError } from "../../errors";
import { pageResult } from "../../conventions";
import { getExam as getExamRecord, getExamAttemptCounts, listExams as listExamRecords } from "../../../lib/examManagement";
import {
  BANK_QUESTION_SCAN_LIMIT, EXAM_QUESTION_SCAN_LIMIT, getQuestion as getQuestionRow,
  listQuestionTags as listQuestionTagRows, listQuestions as listQuestionRows,
  listRecentContentChanges as listRecentContentChangeRows, searchQuestions as searchQuestionsQuery, toQuestion,
} from "../../../lib/questionManagement";
import {
  buildQuestionSetStatistics, findAnswerReferenceIssues, findDuplicateQuestions as groupDuplicateQuestions,
  hasMissingMetadata, isMissingExplanation, missingMetadataFlags,
} from "../../../lib/questionQuality";
import { listTagCatalogNames } from "../../../lib/questionBankTags";
import { page, pageInMemory, summarize, scanMeta } from "../shared";
import type { AdminAdapterContext } from "./context";

// Admin MCP question-bank, quality-control and metadata reads. Read-only:
// no operation here may mutate `db`.
export function questionReadOperations(ctx: AdminAdapterContext) {
  const { db, requireExam, loadExamQuestions } = ctx;

  return {
    // --- Question-bank reads ------------------------------------------------
    // `needsReview` is Admin-only on purpose: it is import/authoring workflow
    // state (issue #15), so it narrows this search but is never a filter the
    // User MCP's own searchQuestions above accepts.
    async searchQuestions(input: { examId: string; q?: string; type?: string; difficulty?: string; tag?: string; needsReview?: boolean; archived?: boolean; limit: number; offset: number }) {
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
        // Admins always see archived provider links, whichever exams are listed.
        includeArchivedProviders: true,
        limit: input.limit + 1,
        offset: input.offset,
      });
      const { items, nextOffset } = pageResult(rows, { limit: input.limit, offset: input.offset });
      return { exams: items, nextOffset };
    },

    async getExam(input: { id: string }) {
      const exam = await getExamRecord(db, input.id, { includeArchivedProviders: true });
      if (!exam) throw new McpApplicationError("not_found");
      return { exam };
    },

    async getExamStatistics(input: { examId: string }) {
      const exam = await getExamRecord(db, input.examId, { includeArchivedProviders: true });
      if (!exam) throw new McpApplicationError("not_found");
      const questions = await loadExamQuestions(input.examId);
      const attempts = await getExamAttemptCounts(db, input.examId);
      const archived = await db.prepare("SELECT COUNT(*) AS n FROM questions WHERE exam_id = ? AND archived_at IS NOT NULL")
        .bind(input.examId).first<{ n: number }>();
      return {
        exam, statistics: buildQuestionSetStatistics(questions, EXAM_QUESTION_SCAN_LIMIT), attempts,
        archivedQuestionCount: archived?.n ?? 0,
      };
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
  };
}
