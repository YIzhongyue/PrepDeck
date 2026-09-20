import type { QuestionTagsResponse } from "@prepdeck/shared";
import { apiFetch } from "./api";

export async function listQuestionTags(signal?: AbortSignal): Promise<string[]> {
  const { tags } = await apiFetch<QuestionTagsResponse>("/api/admin/question-tags", { signal });
  return tags;
}
