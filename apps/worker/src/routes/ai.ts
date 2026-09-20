// docs/requirements/ai-explanations.md — AI Explanation Generation (FR-7.0–FR-7.9) and docs/requirements/non-functional-requirements.md#security-and-privacy's
// accompanying AI-proxy hardening.
//
// The Worker builds the prompt itself from the question already stored in
// D1 — so the only content ever sent upstream is the question's own stem/
// options/answer (docs/requirements/non-functional-requirements.md#security-and-privacy: "must not include PII... only the question
// content is sent") — then relays it to a hardcoded upstream endpoint
// (never a client-supplied URL) together with the caller-supplied key, and
// discards that key the instant the single request/response cycle
// completes. The key is never logged, cached, or written to D1/KV/R2
// (FR-7.4/FR-7.5): only the resulting explanation *text* is persisted, into
// the shared `ai_explanations` cache keyed by (question_id, provider, model)
// (FR-7.3).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { renderExplanationPrompt } from "../lib/prompts";
import type { AiExplanationDto, AiProvider } from "@prepdeck/shared";

// Request guard; see docs/requirements/ai-explanations.md for byte-count limitations.
const MAX_BODY_BYTES = 32 * 1024;

// docs/requirements/non-functional-requirements.md#security-and-privacy: "an endpoint allow-list... never a client-supplied URL".
const UPSTREAM_ENDPOINTS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

interface QuestionRow {
  revision: number;
  id: string;
  type: string;
  stem: string;
  options_json: string | null;
  correct_answers_json: string;
  explanation: string | null;
}

interface ExplanationRow {
  question_id: string;
  provider: string;
  model: string;
  content: string;
  generated_at: string;
  created_by: string | null;
}

function toDto(row: ExplanationRow, viewerId: string, viewerRole: "admin" | "user"): AiExplanationDto {
  return {
    questionId: row.question_id,
    provider: row.provider as AiProvider,
    model: row.model,
    content: row.content,
    generatedAt: row.generated_at,
    canManage: viewerRole === "admin" || row.created_by === viewerId,
  };
}

// Deliberately built server-side from the question row, not accepted from
// the client, so the AI-proxy endpoint can never be used to relay arbitrary
// client-chosen text to the upstream provider (docs/requirements/non-functional-requirements.md#security-and-privacy's "open proxy"
// concern) — it only ever explains a real question already in the bank. The
// template itself lives in prompts/explanation.njk (Nunjucks/Jinja2 syntax);
// see lib/prompts.ts for why it's precompiled rather than rendered live.
function buildPrompt(q: QuestionRow): string {
  const options: { id: string; text: string }[] = q.options_json ? JSON.parse(q.options_json) : [];
  const correctAnswers: string[] = JSON.parse(q.correct_answers_json);
  return renderExplanationPrompt({ stem: q.stem, options, correctAnswers, officialExplanation: q.explanation });
}

// The only logging call site in this file — every other diagnostic signal
// that used to exist here (a call logging every request/response/finish
// reason) was removed for cost/volume reasons. This one is deliberately
// narrow: it fires only on real upstream failures (not on every request),
// and its payload is a fixed, bounded shape — `reason` is one of a small
// closed set of identifiers, never response bodies, prompts, API keys,
// question/user IDs, or model names (the latter is caller-supplied and
// unbounded). See docs/operations/observability-runbook.md.
type AiFailureReason = "http_error" | "empty_content";
function logAiFailure(provider: AiProvider, reason: AiFailureReason, status?: number): void {
  console.log(JSON.stringify({ event: "ai.upstream_failure", provider, reason, status: status ?? null }));
}

// A 4-option "explain why each is right/wrong" response commonly runs long;
// 1024 tokens was cutting Claude off mid-sentence on longer questions
// (confirmed via stop_reason: "max_tokens" while debugging this route) —
// give both providers the same generous headroom instead of relying on
// OpenAI's uncapped default and Anthropic's much stricter one.
const MAX_OUTPUT_TOKENS = 2048;

async function callUpstream(provider: AiProvider, model: string, apiKey: string, prompt: string): Promise<string> {
  if (provider === "openai") {
    const res = await fetch(UPSTREAM_ENDPOINTS.openai, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: MAX_OUTPUT_TOKENS }),
    });
    if (!res.ok) {
      // Do not read, log, or relay the upstream response body: providers may
      // echo request material or credentials in diagnostic responses.
      logAiFailure("openai", "http_error", res.status);
      throw new Error(`OpenAI request failed (${res.status})`);
    }
    const data = await res.json<any>();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      logAiFailure("openai", "empty_content");
      throw new Error("OpenAI returned no explanation text");
    }
    return content.trim();
  }

  const res = await fetch(UPSTREAM_ENDPOINTS.anthropic, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    logAiFailure("anthropic", "http_error", res.status);
    throw new Error(`Anthropic request failed (${res.status})`);
  }
  const data = await res.json<any>();
  // Anthropic's `content` is an array of blocks (text/thinking/tool_use/...);
  // find the first text block rather than assuming index 0 is text.
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const textBlock = blocks.find((b) => b && b.type === "text" && typeof b.text === "string");
  const content = textBlock?.text;
  if (typeof content !== "string" || !content.trim()) {
    logAiFailure("anthropic", "empty_content");
    throw new Error("Anthropic returned no explanation text");
  }
  return content.trim();
}

function validateProviderModel(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid JSON body";
  if (body.provider !== "openai" && body.provider !== "anthropic") return "provider must be 'openai' or 'anthropic'";
  if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 100) return "model is required";
  return null;
}

// Mounted at /api/questions/:questionId/ai-explanations — FR-7.2/FR-7.3:
// lets the client check for a cached explanation (any provider/model) before
// ever asking the user for a key, at no cost.
export const questionAiExplanationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

questionAiExplanationsRouter.get("/", async (c) => {
  const questionId = c.req.param("questionId");
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT question_id, provider, model, content, generated_at, created_by FROM ai_explanations WHERE question_id = ? ORDER BY generated_at DESC"
  )
    .bind(questionId)
    .all<ExplanationRow>();
  return c.json({ explanations: (results ?? []).map((r) => toDto(r, user.id, user.role)) });
});

// FR-7.7: Admin, or whoever's key first generated this entry, may manually
// edit its stored text.
questionAiExplanationsRouter.patch("/:provider/:model", async (c) => {
  const questionId = c.req.param("questionId");
  const provider = c.req.param("provider");
  const model = c.req.param("model");
  const user = c.get("user");

  const existing = await c.env.DB.prepare(
    "SELECT question_id, provider, model, content, generated_at, created_by FROM ai_explanations WHERE question_id = ? AND provider = ? AND model = ?"
  )
    .bind(questionId, provider, model)
    .first<ExplanationRow>();
  if (!existing) return c.json({ error: "Cached explanation not found" }, 404);
  if (user.role !== "admin" && existing.created_by !== user.id) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return c.json({ error: "content is required" }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE ai_explanations SET content = ?, updated_at = ? WHERE question_id = ? AND provider = ? AND model = ?"
  )
    .bind(body.content.trim(), now, questionId, provider, model)
    .run();

  const row = await c.env.DB.prepare(
    "SELECT question_id, provider, model, content, generated_at, created_by FROM ai_explanations WHERE question_id = ? AND provider = ? AND model = ?"
  )
    .bind(questionId, provider, model)
    .first<ExplanationRow>();
  return c.json({ explanation: toDto(row!, user.id, user.role) });
});

// Mounted at /api/ai/generate — FR-7.4: the fixed, same-origin AI-proxy
// endpoint. Rate-limited and size-capped per docs/requirements/non-functional-requirements.md#security-and-privacy.
export const aiGenerateRouter = new Hono<{ Bindings: Env; Variables: Variables }>();


aiGenerateRouter.post("/", async (c) => {
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return c.json({ error: "Request too large" }, 413);

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: "Request too large" }, 413);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body?.questionId !== "string") return c.json({ error: "questionId is required" }, 400);
  const providerModelError = validateProviderModel(body);
  if (providerModelError) {
    return c.json({ error: providerModelError }, 400);
  }

  const questionId: string = body.questionId;
  const provider: AiProvider = body.provider;
  const model: string = body.model.trim();
  const force = body.force === true;
  const user = c.get("user");

  const question = await c.env.DB.prepare(
    "SELECT id, type, stem, options_json, correct_answers_json, explanation, revision FROM questions WHERE id = ?"
  )
    .bind(questionId)
    .first<QuestionRow>();
  if (!question) {
    return c.json({ error: "Question not found" }, 404);
  }

  const existing = await c.env.DB.prepare(
    "SELECT question_id, provider, model, content, generated_at, created_by FROM ai_explanations WHERE question_id = ? AND provider = ? AND model = ?"
  )
    .bind(questionId, provider, model)
    .first<ExplanationRow>();

  if (existing && force && user.role !== "admin" && existing.created_by !== user.id) {
    return c.json({ error: "Only Admin or the original requester may regenerate this explanation" }, 403);
  }

  // FR-7.2/FR-7.3: a cache hit for the requested (question, provider, model)
  // is served immediately, at no cost and without needing a key — even one
  // reached via this generate endpoint rather than the cache-check GET above
  // (e.g. a race between two users, or a client that skipped the GET).
  if (existing && !force) {
    return c.json({ explanation: toDto(existing, user.id, user.role), cached: true } satisfies { explanation: AiExplanationDto; cached: boolean });
  }

  if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    return c.json({ error: "apiKey is required" }, 400);
  }
  const apiKey: string = body.apiKey;

  let content: string;
  try {
    content = await callUpstream(provider, model, apiKey, buildPrompt(question));
  } catch (err) {
    // Never surface the key in an error message, and nothing about this
    // request is logged anywhere that could capture it.
    const message = err instanceof Error ? err.message : "Upstream request failed";
    return c.json({ error: message }, 502);
  }

  const now = new Date().toISOString();
  // A cache miss may race another generation or a manual correction. Only
  // an explicitly authorized regeneration may replace the row it reviewed.
  const saved = existing && force
    ? await c.env.DB.prepare(
        `UPDATE ai_explanations SET content = ?, generated_at = ?, updated_at = ?
         WHERE question_id = ? AND provider = ? AND model = ? AND content = ?
           AND generated_at = ? AND created_by IS ?
           AND EXISTS (SELECT 1 FROM questions WHERE id = ? AND revision = ?)`
      ).bind(content, now, now, questionId, provider, model, existing.content,
        existing.generated_at, existing.created_by, questionId, question.revision).run()
    : await c.env.DB.prepare(
        `INSERT INTO ai_explanations (question_id, provider, model, content, generated_at, created_by, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ? FROM questions WHERE id = ? AND revision = ?
         ON CONFLICT (question_id, provider, model) DO NOTHING`
      ).bind(questionId, provider, model, content, now, user.id, now, questionId, question.revision).run();

  const stored = await c.env.DB.prepare(
    `SELECT ae.question_id, ae.provider, ae.model, ae.content, ae.generated_at, ae.created_by
     FROM ai_explanations ae JOIN questions q ON q.id = ae.question_id
     WHERE ae.question_id = ? AND ae.provider = ? AND ae.model = ? AND q.revision = ?`
  ).bind(questionId, provider, model, question.revision).first<ExplanationRow>();
  // !stored also covers "the write landed, but the question was edited before
  // this read" — the explanation is persisted against the previous revision, so
  // the honest answer is still "re-check the latest content", and the retry is
  // a free cache hit rather than a second upstream call.
  if (!stored || (existing && force && !saved.meta.changes)) {
    return c.json({ error: "The question or its explanation changed during generation. Reopen it to see the current version, then try again." }, 409);
  }
  return c.json({ explanation: toDto(stored, user.id, user.role), cached: !saved.meta.changes });
});
