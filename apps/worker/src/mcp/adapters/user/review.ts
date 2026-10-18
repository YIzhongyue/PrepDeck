import { McpApplicationError } from "../../errors";
import { pageResult } from "../../conventions";
import { presentQuestion, type ImageMode, type PresentationRow } from "../../questionPresentation";
import { getExam as getExamRecord, listExams as listExamRecords } from "../../../lib/examManagement";
import {
  getQuestion as getQuestionRow, listQuestionTags as listQuestionTagRows,
  searchQuestions as searchQuestionsQuery, toQuestion,
} from "../../../lib/questionManagement";
import { toAttempt, listAttempts as listAttemptRows, getAttemptDetail } from "../../../lib/attemptQuery";
import { listWrongQuestions } from "../../../lib/wrongBookQuery";
import { listBookmarkedQuestions } from "../../../lib/bookmarksQuery";
import { listUnattemptedQuestions } from "../../../lib/unattemptedQuery";
import { selectQuestions, selectQuestionsForReview, type DailyReviewQuestion } from "../../../lib/practiceSelection";
import {
  buildAnnotationsListQuery, toAnnotation, listAnnotationsForQuestion as listAnnotationsForQuestionRows,
  type AnnotationRow,
} from "../../../lib/annotationsQuery";
import { page } from "../shared";
import type { UserAdapterContext } from "./context";

// User MCP reads for attempts, review sets, question discovery, study
// selection and annotations. All side-effect free.
export function reviewOperations(ctx: UserAdapterContext) {
  const { db, userId, requireExam } = ctx;

  return {
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
    //
    // Archived questions (issues #92/#93) never appear in a search, listing
    // or selection. Reads by id (get/present) still resolve them, so an
    // attempt or note that already references one keeps working; the
    // returned question then carries its archivedAt.
    async searchQuestions(input: { examId: string; q?: string; type?: string; difficulty?: string; tag?: string; limit: number; offset: number }) {
      return searchQuestionsQuery(db, input.examId, { ...input, archived: false });
    },

    async getQuestion(input: { examId: string; id: string }) {
      const row = await getQuestionRow(db, input.examId, input.id);
      if (!row) throw new McpApplicationError("not_found");
      return { question: toQuestion(row) };
    },

    async presentQuestion(input: { examId: string; id: string; imageMode: ImageMode }) {
      // Deliberately never select grading, explanation, annotation or import
      // baseline columns. Candidate text cannot substitute for content_json.
      const row = await db.prepare(`SELECT id, exam_id, revision, type, stem, options_json, content_json
        FROM questions WHERE exam_id = ? AND id = ?`).bind(input.examId, input.id).first<PresentationRow>();
      if (!row) throw new McpApplicationError("not_found");
      return presentQuestion(row, input.imageMode);
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
      const rows = await listQuestionTagRows(db, { ...input, activeOnly: true });
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
  };
}
