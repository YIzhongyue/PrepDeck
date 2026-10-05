-- Issue #119 — per-user, per-question studied status.
--
-- "Studied" records exposure to a question: it was displayed in Learning, or
-- the user recorded a real answer to it in Practice or Mock. It is not mastery
-- and not correctness, and it is separate from learning_progress (a resume
-- pointer, which cannot tell which questions were actually visited) and from
-- "attempted" (derived from attempt_answers, which Learning never writes).
--
-- Explicit 'unstudied' rows are kept, never deleted: a manual reset has to stay
-- durable even for a question with answers on record. A missing row means
-- unstudied.
--
-- `revision` moves on every change. Learning's automatic mark is conditional on
-- the revision the client last saw, so a delayed or retried visit cannot undo a
-- newer manual reset (see apps/worker/src/lib/studyStatus.ts).
--
-- Exam scope comes through questions.exam_id. Deleting a question drops its
-- statuses with it: exposure data must not make a question undeletable, which
-- is what the other per-user question tables do on purpose.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

CREATE TABLE user_question_study_status (
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('studied', 'unstudied')),
  -- What last changed the status. Informational; never used for precedence.
  source TEXT NOT NULL CHECK (source IN ('learning', 'practice', 'mock', 'manual', 'backfill')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX idx_study_status_question ON user_question_study_status(question_id);

-- Backfill: every question the user genuinely answered in Practice or Mock.
-- Mock completion writes an attempt_answers row for every question, answered
-- or not, so a row alone is not an answer: this applies the same rule as
-- hasAnswer() in packages/shared/src/grading.ts (a fill-in needs a non-blank
-- entry; any other type needs a selection).
--
-- Nothing is inferred from learning_progress: a resume pointer says where the
-- user stopped, not which earlier questions they actually saw.
--
-- ON CONFLICT DO NOTHING throughout, so a rerun never overwrites a reset.
INSERT INTO user_question_study_status (user_id, question_id, status, source, revision, updated_at)
SELECT a.user_id, aa.question_id, 'studied', 'backfill', 1, MAX(COALESCE(aa.answered_at, a.completed_at, a.started_at))
FROM attempt_answers aa
JOIN attempts a ON a.id = aa.attempt_id
JOIN questions q ON q.id = aa.question_id
WHERE json_valid(aa.selected_answer_json) AND EXISTS (
  SELECT 1 FROM json_each(aa.selected_answer_json) s
  WHERE q.type != 'fill_blank'
     OR (s.type = 'text' AND trim(s.value, ' ' || char(9, 10, 11, 12, 13, 160)) != '')
)
GROUP BY a.user_id, aa.question_id
ON CONFLICT(user_id, question_id) DO NOTHING;

-- Non-empty answers saved in a still-open Mock: from now on a saved draft
-- marks its question as studied, so drafts saved before this migration do too.
INSERT INTO user_question_study_status (user_id, question_id, status, source, revision, updated_at)
SELECT a.user_id, d.key, 'studied', 'backfill', 1, MAX(a.started_at)
FROM attempts a
JOIN json_each(CASE WHEN json_valid(a.draft_answers_json) AND json_type(a.draft_answers_json) = 'object' THEN a.draft_answers_json ELSE '{}' END) d
JOIN questions q ON q.id = d.key
WHERE a.mode = 'mock' AND a.completed_at IS NULL
  AND EXISTS (SELECT 1 FROM json_each(a.question_ids_json) i WHERE i.value = d.key)
  AND d.type = 'array' AND EXISTS (
    SELECT 1 FROM json_each(d.value) s
    WHERE q.type != 'fill_blank'
       OR (s.type = 'text' AND trim(s.value, ' ' || char(9, 10, 11, 12, 13, 160)) != '')
  )
GROUP BY a.user_id, d.key
ON CONFLICT(user_id, question_id) DO NOTHING;
