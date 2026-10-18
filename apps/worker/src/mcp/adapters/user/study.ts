import { McpApplicationError } from "../../errors";
import { pageResult } from "../../conventions";
import { getExam as getExamRecord } from "../../../lib/examManagement";
import {
  pct as accuracyPct, computeStudyActivity, computeExamStatsSummary, computeExamStatsPage, ANSWERED_AT_SQL,
  GRADED_ANSWER_SQL,
} from "../../../lib/learningStats";
import { loadUserTimeZone } from "../../../lib/userTimeZone";
import { startAttempt, submitPracticeAnswer, completeAttempt } from "../../../lib/attemptMutations";
import { setLearningProgress } from "../../../lib/learningProgressMutation";
import type { SubmitPracticeAnswerRequest } from "@prepdeck/shared";
import { studyMutationData } from "../shared";
import type { UserAdapterContext } from "./context";

// User MCP study writes (Practice and Learning Mode through the canonical
// attempt services) and learning statistics.

// Response-size bounds for get_learning_overview and get_learning_stats.
const MAX_OVERVIEW_EXAMS = 50;
const MAX_TREND_POINTS = 366;
const MAX_TAG_BREAKDOWN = 200;

export function studyOperations(ctx: UserAdapterContext) {
  const { db, env, userId, consumeStudyWriteLimit } = ctx;

  return {
    // --- Explicit study writes (identity always comes from the credential) ---
    async startPractice(input: { examId: string; questionIds: string[] }) {
      await consumeStudyWriteLimit();
      return studyMutationData(await startAttempt(env, userId, input.examId, { mode: "practice", questionIds: input.questionIds }));
    },
    async submitPracticeAnswer(input: SubmitPracticeAnswerRequest & { attemptId: string }) {
      await consumeStudyWriteLimit();
      return studyMutationData(await submitPracticeAnswer(env, userId, input.attemptId, input, { requireAnswer: true }));
    },
    async completePractice(input: { attemptId: string }) {
      await consumeStudyWriteLimit();
      return studyMutationData(await completeAttempt(env, userId, input.attemptId, { practiceOnly: true }));
    },
    async setLearningProgress(input: { examId: string; sequenceNumber: number }) {
      await consumeStudyWriteLimit();
      return studyMutationData(await setLearningProgress(db, userId, input.examId, input));
    },

    // --- Learning overview and statistics -----------------------------------
    // Three separate per-exam aggregate queries, merged in application code —
    // deliberately NOT one join across attempts/bookmarks/wrong_question_book,
    // which (being unrelated one-to-many relations on the same exam) would
    // fan out rows and inflate counts (e.g. 3 bookmarks x 5 wrong entries on
    // one exam miscounted as 15 of something).
    async getLearningOverview(input: { days: number }) {
      const [timeZone, attemptRows, bookmarkRows, wrongRows] = await Promise.all([
        loadUserTimeZone(db, userId),
        db.prepare(
          // Graded answers count whether or not their session was ended, as in
          // the dashboard (lib/learningStats.ts, issue #40).
          `SELECT a.exam_id AS exam_id,
                  COUNT(DISTINCT aa.question_id) AS attempted_questions,
                  COUNT(aa.id) AS total_answers,
                  COALESCE(SUM(aa.is_correct), 0) AS correct_answers,
                  NULLIF(MAX(MAX(COALESCE(a.completed_at, ''), CASE WHEN aa.id IS NULL THEN '' ELSE ${ANSWERED_AT_SQL} END)), '') AS last_attempt_at
           FROM attempts a
           LEFT JOIN attempt_answers aa ON aa.attempt_id = a.id
           WHERE a.user_id = ? AND ${GRADED_ANSWER_SQL}
           GROUP BY a.exam_id`,
        ).bind(userId).all<{ exam_id: string; attempted_questions: number; total_answers: number; correct_answers: number; last_attempt_at: string | null }>(),
        db.prepare(
          `SELECT q.exam_id AS exam_id, COUNT(*) AS n FROM bookmarks b JOIN questions q ON q.id = b.question_id
           WHERE b.user_id = ? AND q.archived_at IS NULL GROUP BY q.exam_id`,
        ).bind(userId).all<{ exam_id: string; n: number }>(),
        db.prepare(
          `SELECT q.exam_id AS exam_id, COUNT(*) AS n FROM wrong_question_book w JOIN questions q ON q.id = w.question_id
           WHERE w.user_id = ? AND w.mastered = 0 AND q.archived_at IS NULL GROUP BY q.exam_id`,
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
        return { exams: [], truncated: false, activity: await computeStudyActivity(db, userId, { days: input.days, timeZone }) };
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
        activity: await computeStudyActivity(db, userId, { days: input.days, timeZone }),
      };
    },

    async getExamProgress(input: { examId: string }) {
      const exam = await getExamRecord(db, input.examId);
      if (!exam) throw new McpApplicationError("not_found");
      // Summary-only (no trend/tag/mock-history queries) — this tool only
      // ever reads three fields off the stats, so it must not run (or
      // KV-cache) the REST dashboard's full computeExamStats to get them.
      // Counts match user_get_bookmarked_questions/user_get_wrong_questions,
      // which leave archived questions out.
      const [progressRow, bookmarkCount, wrongCount, stats] = await Promise.all([
        db.prepare("SELECT last_sequence_number FROM learning_progress WHERE user_id = ? AND exam_id = ?")
          .bind(userId, input.examId).first<{ last_sequence_number: number }>(),
        db.prepare(
          `SELECT COUNT(*) AS n FROM bookmarks b JOIN questions q ON q.id = b.question_id WHERE b.user_id = ? AND q.exam_id = ? AND q.archived_at IS NULL`,
        ).bind(userId, input.examId).first<{ n: number }>(),
        db.prepare(
          `SELECT COUNT(*) AS n FROM wrong_question_book w JOIN questions q ON q.id = w.question_id WHERE w.user_id = ? AND q.exam_id = ? AND w.mastered = 0 AND q.archived_at IS NULL`,
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
        timeZone: await loadUserTimeZone(db, userId),
      });
      if (!page) throw new McpApplicationError("not_found");
      const { items: mockScoreHistory, nextOffset: mockScoreHistoryNextOffset } =
        pageResult(page.mockScoreHistoryRows, { limit: input.limit, offset: input.offset });
      return {
        examId: page.examId,
        timeZone: page.timeZone,
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
  };
}
