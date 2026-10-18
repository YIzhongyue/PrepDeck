// DTOs for docs/requirements/ai-explanations.md — AI Explanation Generation (FR-7.0–FR-7.9). The
// Worker never sees a plaintext key outside a single generate request (see
// apps/worker/src/routes/ai.ts); these types only ever carry the cached
// explanation text, never the provider API key.

import type { AiProvider } from "./types";
import type { z } from "zod";
import type { generateAiExplanationRequestSchema, updateAiExplanationRequestSchema } from "./ai.schema.ts";

export interface AiModelOption {
  id: string;
  label: string;
}

// FR-7.0(c): a curated, provider-specific dropdown; the UI additionally lets
// the user type any other model id (advanced/custom use).
export const CURATED_MODELS: Record<AiProvider, AiModelOption[]> = {
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
};

export interface AiExplanationDto {
  questionId: string;
  provider: AiProvider;
  model: string;
  content: string;
  generatedAt: string;
  // FR-7.7: Admin, or whichever user's key first populated this cache entry,
  // may force-regenerate or manually edit it.
  canManage: boolean;
}

export interface AiExplanationsListResponse {
  explanations: AiExplanationDto[];
}

export type GenerateAiExplanationRequest = z.input<typeof generateAiExplanationRequestSchema>;

export interface GenerateAiExplanationResponse {
  explanation: AiExplanationDto;
  cached: boolean;
}

export type UpdateAiExplanationRequest = z.input<typeof updateAiExplanationRequestSchema>;
