// DTOs for docs/requirements/ai-explanations.md — AI Explanation Generation (FR-7.0–FR-7.9). The
// Worker never sees a plaintext key outside a single generate request (see
// apps/worker/src/routes/ai.ts); these types only ever carry the cached
// explanation text, never the provider API key.

import type { AiProvider } from "./types";

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

export interface GenerateAiExplanationRequest {
  questionId: string;
  provider: AiProvider;
  model: string;
  // Sent once, forwarded to the upstream provider, and never persisted or
  // echoed back (FR-7.4/FR-7.5/docs/requirements/non-functional-requirements.md#security-and-privacy). Not required on a cache hit.
  apiKey?: string;
  // FR-7.7: bypass the cache and call upstream again, overwriting the entry.
  force?: boolean;
}

export interface GenerateAiExplanationResponse {
  explanation: AiExplanationDto;
  cached: boolean;
}

export interface UpdateAiExplanationRequest {
  content: string;
}
