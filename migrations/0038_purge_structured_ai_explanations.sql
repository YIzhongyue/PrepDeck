-- issue #42 — AI explanations for matching and ordering questions were
-- generated from incomplete prompts: a matching question was sent with its
-- left column only and its answer as ID pairs such as ["L1","R2"], so the model
-- explained pairings with items it had never seen, and an ordering question's
-- instructions asked about "incorrect options" it does not have. Those results
-- sit in the shared ai_explanations cache and are served to every learner.
--
-- The prompt now includes both columns and readable answers
-- (apps/worker/src/routes/ai.ts, prompts/explanation.njk). Remove the cached
-- results for these two types so the next request generates one from the full
-- question. Choice and fill-in explanations are unaffected and kept.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

DELETE FROM ai_explanations
WHERE question_id IN (SELECT id FROM questions WHERE type IN ('matching', 'ordering'));
