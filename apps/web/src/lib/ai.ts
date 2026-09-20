import type {
  AiExplanationDto,
  AiExplanationsListResponse,
  GenerateAiExplanationResponse,
} from "@prepdeck/shared";
import { apiFetch } from "./api";
import type { Provider } from "../store/PrepDeckContext";

export function fetchCachedExplanations(questionId: string): Promise<AiExplanationDto[]> {
  return apiFetch<AiExplanationsListResponse>(`/api/questions/${questionId}/ai-explanations`).then(
    (r) => r.explanations
  );
}

export function generateExplanation(
  questionId: string,
  provider: Provider,
  model: string,
  apiKey: string,
  force?: boolean
): Promise<GenerateAiExplanationResponse> {
  return apiFetch<GenerateAiExplanationResponse>("/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ questionId, provider, model, apiKey, force }),
  });
}

export function updateExplanation(
  questionId: string,
  provider: Provider,
  model: string,
  content: string
): Promise<AiExplanationDto> {
  return apiFetch<{ explanation: AiExplanationDto }>(
    `/api/questions/${questionId}/ai-explanations/${provider}/${encodeURIComponent(model)}`,
    { method: "PATCH", body: JSON.stringify({ content }) }
  ).then((r) => r.explanation);
}
