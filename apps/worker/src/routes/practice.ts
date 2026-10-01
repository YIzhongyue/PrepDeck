// docs/requirements/practice-and-learning-modes.md — the read-only catalog that powers both Practice Setup
// (FR-3.1 filters: tag/difficulty/type/unattempted/bookmarked/wrong-book) and
// Mock Setup (question count for its default). Deliberately hands back every
// question's text projections and filter metadata, without component assets or
// correctAnswers/explanation. Full component snapshots load only on opening a
// question through the answer-key-free detail endpoint below —
// the client filters/picks locally from this, same as the existing UI
// prototype did against its hardcoded mock array, and never sees an answer
// key before it grades a specific question through the attempts API.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { getCachedPracticeQuestions, setCachedPracticeQuestions } from "../lib/practiceCache";
import { tagsJsonExpr } from "../lib/questionManagement";
import type { PracticeCatalogQuestion, PracticeCatalogResponse, PracticeQuestionContentResponse } from "@prepdeck/shared";

interface QuestionRow {
  id: string;
  external_id: string | null;
  sequence_number: number;
  type: string;
  stem: string;
  has_content: number;
  revision: number;
  options_json: string | null;
  correct_answers_json: string;
  difficulty: string | null;
  tags_json: string | null;
  points: number;
  needs_review: number;
}

const CATALOG_COLUMNS = `id, external_id, sequence_number, type, stem, content_json IS NOT NULL AS has_content, revision, options_json, correct_answers_json, difficulty, ${tagsJsonExpr("questions")} AS tags_json, points, needs_review`;

function toCatalogQuestion(row: QuestionRow): PracticeCatalogQuestion {
  const correctAnswers = JSON.parse(row.correct_answers_json) as string[];
  return {
    id: row.id,
    externalId: row.external_id,
    sequenceNumber: row.sequence_number,
    type: row.type as PracticeCatalogQuestion["type"],
    stem: row.stem,
    hasContent: !!row.has_content,
    revision: row.revision,
    options: row.options_json ? JSON.parse(row.options_json) : null,
    chooseCount: row.type === "multiple_choice" ? correctAnswers.length : null,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    difficulty: row.difficulty as PracticeCatalogQuestion["difficulty"],
    points: row.points,
    needsReview: row.needs_review !== 0,
  };
}

export const practiceCatalogRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

practiceCatalogRouter.get("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  // The per-user lists name active questions only, so every count the client
  // derives from them (bookmarks, wrong book, "new") matches `questions`.
  const [cachedQuestions, { results: bookmarkRows }, { results: wrongRows }, { results: attemptedRows }, { results: archivedRows }] =
    await Promise.all([
      getCachedPracticeQuestions(c.env, examId),
      c.env.DB.prepare(`SELECT b.question_id FROM bookmarks b JOIN questions q ON q.id = b.question_id
        WHERE b.user_id = ? AND q.exam_id = ? AND q.archived_at IS NULL`).bind(userId, examId).all<{ question_id: string }>(),
      c.env.DB.prepare(`SELECT w.question_id, w.wrong_count, w.last_wrong_at FROM wrong_question_book w
         JOIN questions q ON q.id = w.question_id WHERE w.user_id = ? AND q.exam_id = ? AND w.mastered = 0 AND q.archived_at IS NULL`)
        .bind(userId, examId)
        .all<{ question_id: string; wrong_count: number; last_wrong_at: string }>(),
      c.env.DB.prepare(
        `SELECT DISTINCT aa.question_id FROM attempt_answers aa
         JOIN attempts a ON a.id = aa.attempt_id
         JOIN questions q ON q.id = aa.question_id AND q.archived_at IS NULL
         WHERE a.user_id = ? AND a.exam_id = ?`
      )
        .bind(userId, examId)
        .all<{ question_id: string }>(),
      // An attempt keeps the questions it started with, so one archived
      // mid-attempt must still render when that attempt is resumed. Per user
      // and bounded by the open attempts' own size, so never cached.
      c.env.DB.prepare(
        `SELECT ${CATALOG_COLUMNS} FROM questions WHERE exam_id = ? AND archived_at IS NOT NULL AND id IN (
           SELECT j.value FROM attempts a, json_each(a.question_ids_json) j
           WHERE a.user_id = ? AND a.exam_id = ? AND a.completed_at IS NULL
         ) ORDER BY sequence_number, id`
      )
        .bind(examId, userId, examId)
        .all<QuestionRow>(),
    ]);

  let questions: PracticeCatalogQuestion[];
  if (cachedQuestions) {
    questions = cachedQuestions;
  } else {
    const { results: questionRows } = await c.env.DB.prepare(
      // FR-14.1: ordered by sequence_number so Learning Mode can walk the
      // exam's questions in order directly off this same catalog. Archiving
      // invalidates this cache like any other question-bank change.
      `SELECT ${CATALOG_COLUMNS} FROM questions WHERE exam_id = ? AND archived_at IS NULL ORDER BY sequence_number ASC`
    )
      .bind(examId)
      .all<QuestionRow>();

    questions = (questionRows ?? []).map(toCatalogQuestion);

    await setCachedPracticeQuestions(c.env, examId, questions);
  }

  const response: PracticeCatalogResponse = {
    questions,
    bookmarkedIds: (bookmarkRows ?? []).map((r) => r.question_id),
    wrongEntries: (wrongRows ?? []).map((r) => ({
      questionId: r.question_id,
      wrongCount: r.wrong_count,
      lastWrongAt: r.last_wrong_at,
    })),
    attemptedIds: (attemptedRows ?? []).map((r) => r.question_id),
    archivedQuestions: (archivedRows ?? []).map(toCatalogQuestion),
  };

  return c.json(response);
});

// Practice/Mock must not use learning-detail, which deliberately includes the
// answer key. Keep the exam scope explicit even though question ids are unique.
// Archived questions still load here: an unfinished attempt may contain one.
practiceCatalogRouter.get("/:questionId", async (c) => {
  const row = await c.env.DB.prepare("SELECT content_json, revision FROM questions WHERE exam_id = ? AND id = ?")
    .bind(c.req.param("examId")!, c.req.param("questionId"))
    .first<{ content_json: string | null; revision: number }>();
  if (!row) return c.json({ error: "Question not found" }, 404);
  const response: PracticeQuestionContentResponse = { content: row.content_json ? JSON.parse(row.content_json) : null, revision: row.revision };
  return c.json(response);
});
