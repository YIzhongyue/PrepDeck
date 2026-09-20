// docs/requirements/practice-and-learning-modes.md — the read-only catalog that powers both Practice Setup
// (FR-3.1 filters: tag/difficulty/type/unattempted/bookmarked/wrong-book) and
// Mock Setup (question count for its default). Deliberately hands back every
// non-archived question's full content EXCEPT correctAnswers/explanation —
// the client filters/picks locally from this, same as the existing UI
// prototype did against its hardcoded mock array, and never sees an answer
// key before it grades a specific question through the attempts API.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { getCachedPracticeQuestions, setCachedPracticeQuestions } from "../lib/practiceCache";
import { tagsJsonExpr } from "../lib/questionManagement";
import type { PracticeCatalogQuestion, PracticeCatalogResponse } from "@prepdeck/shared";

interface QuestionRow {
  id: string;
  external_id: string | null;
  sequence_number: number;
  type: string;
  stem: string;
  options_json: string | null;
  correct_answers_json: string;
  difficulty: string | null;
  tags_json: string | null;
  points: number;
}

export const practiceCatalogRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

practiceCatalogRouter.get("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  const [cachedQuestions, { results: bookmarkRows }, { results: wrongRows }, { results: attemptedRows }] =
    await Promise.all([
      getCachedPracticeQuestions(c.env, examId),
      c.env.DB.prepare(`SELECT b.question_id FROM bookmarks b JOIN questions q ON q.id = b.question_id
        WHERE b.user_id = ? AND q.exam_id = ?`).bind(userId, examId).all<{ question_id: string }>(),
      c.env.DB.prepare(`SELECT w.question_id, w.wrong_count, w.last_wrong_at FROM wrong_question_book w
         JOIN questions q ON q.id = w.question_id WHERE w.user_id = ? AND q.exam_id = ? AND w.mastered = 0`)
        .bind(userId, examId)
        .all<{ question_id: string; wrong_count: number; last_wrong_at: string }>(),
      c.env.DB.prepare(
        `SELECT DISTINCT aa.question_id FROM attempt_answers aa
         JOIN attempts a ON a.id = aa.attempt_id
         WHERE a.user_id = ? AND a.exam_id = ?`
      )
        .bind(userId, examId)
        .all<{ question_id: string }>(),
    ]);

  let questions: PracticeCatalogQuestion[];
  if (cachedQuestions) {
    questions = cachedQuestions;
  } else {
    const { results: questionRows } = await c.env.DB.prepare(
      // FR-14.1: ordered by sequence_number so Learning Mode can walk the
      // exam's questions in order directly off this same catalog.
      `SELECT id, external_id, sequence_number, type, stem, options_json, correct_answers_json, difficulty, ${tagsJsonExpr("questions")} AS tags_json, points FROM questions WHERE exam_id = ? ORDER BY sequence_number ASC`
    )
      .bind(examId)
      .all<QuestionRow>();

    questions = (questionRows ?? []).map((row) => {
      const correctAnswers = JSON.parse(row.correct_answers_json) as string[];
      return {
        id: row.id,
        externalId: row.external_id,
        sequenceNumber: row.sequence_number,
        type: row.type as PracticeCatalogQuestion["type"],
        stem: row.stem,
        options: row.options_json ? JSON.parse(row.options_json) : null,
        chooseCount: row.type === "multiple_choice" ? correctAnswers.length : null,
        tags: row.tags_json ? JSON.parse(row.tags_json) : [],
        difficulty: row.difficulty as PracticeCatalogQuestion["difficulty"],
        points: row.points,
      };
    });

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
  };

  return c.json(response);
});
