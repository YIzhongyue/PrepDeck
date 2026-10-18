// Request bodies for AI explanations (FR-7.2–FR-7.7). See ai.ts for the
// response DTOs.

import { z } from "zod";

const MODEL = "model is required";
const CONTENT = "content is required";

// POST /api/ai/generate.
export const generateAiExplanationRequestSchema = z.object({
  questionId: z.string("questionId is required"),
  provider: z.enum(["openai", "anthropic"], "provider must be 'openai' or 'anthropic'"),
  // At most 100 characters as sent; used trimmed.
  model: z.string(MODEL).max(100, MODEL).trim().min(1, MODEL),
  // Sent once, forwarded to the upstream provider, and never persisted or
  // echoed back (FR-7.4/FR-7.5/docs/requirements/non-functional-requirements.md#security-and-privacy). Not required on a cache hit,
  // so the route checks it only on a miss; anything but a string counts as missing.
  apiKey: z.string().optional().catch(undefined),
  // FR-7.7: bypass the cache and call upstream again, overwriting the entry.
  // Only `true` forces a regeneration.
  force: z.boolean().optional().catch(undefined),
}, "questionId is required");

// PATCH /api/questions/:questionId/ai-explanations/:provider/:model. Stored trimmed.
export const updateAiExplanationRequestSchema = z.object({
  content: z.string(CONTENT).trim().min(1, CONTENT),
}, CONTENT);
