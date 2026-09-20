// implementation — thin apiFetch wrappers for the Knowledge Points API. The
// shared DTOs (packages/shared/src/knowledgePoints.ts) are already
// camelCase and shaped for direct use in components, so — unlike
// lib/notes.ts's fromSharedNote — there's no separate leaner local type to
// map into here; components consume the shared types directly.

import { apiFetch, ApiError } from "./api";
import type {
  AutosaveConflictResponse,
  AutosaveKnowledgePointRequest,
  CreateKnowledgePointRequest,
  KnowledgePointGroupResponse,
  KnowledgePointGroupsListResponse,
  KnowledgePointResponse,
  KnowledgePointSort,
  KnowledgePointTag,
  KnowledgePointTagsListResponse,
  KnowledgePointsListResponse,
  LinkableQuestionsResponse,
} from "@prepdeck/shared";

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export interface KnowledgePointsListParams {
  groupId?: string | null;
  ungrouped?: boolean;
  tagIds?: string[];
  q?: string;
  sort?: KnowledgePointSort;
  limit?: number;
  offset?: number;
  // implementation — the Learning Mode "related knowledge points" card.
  linkedQuestionId?: string;
  // implementation — "Related to this exam" filter; omitted for the default
  // "All personal knowledge points" view.
  examId?: string;
}

export function listKnowledgePoints(params: KnowledgePointsListParams): Promise<KnowledgePointsListResponse> {
  const qs = buildQuery({
    groupId: params.ungrouped ? undefined : (params.groupId ?? undefined),
    ungrouped: params.ungrouped ? "true" : undefined,
    tagIds: params.tagIds?.length ? params.tagIds.join(",") : undefined,
    q: params.q,
    sort: params.sort,
    linkedQuestionId: params.linkedQuestionId,
    examId: params.examId,
    limit: params.limit,
    offset: params.offset,
  });
  return apiFetch<KnowledgePointsListResponse>(`/api/knowledge-points${qs}`);
}

export function createKnowledgePoint(body: CreateKnowledgePointRequest = {}): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points`, { method: "POST", body: JSON.stringify(body) });
}

export function getKnowledgePoint(id: string): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}`);
}

export function autosaveKnowledgePoint(id: string, body: AutosaveKnowledgePointRequest): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteKnowledgePoint(id: string): Promise<void> {
  return apiFetch(`/api/knowledge-points/${id}`, { method: "DELETE" });
}

export function setKnowledgePointGroup(id: string, groupId: string | null): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}/group`, { method: "PATCH", body: JSON.stringify({ groupId }) });
}

export function reorderKnowledgePoint(id: string, beforeId: string | null, expectedOrderRevision: number): Promise<{ position: number }> {
  return apiFetch(`/api/knowledge-points/${id}/reorder`, { method: "PATCH", body: JSON.stringify({ beforeId, expectedOrderRevision }) });
}

export function linkQuestionToKnowledgePoint(id: string, questionId: string): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}/questions`, { method: "POST", body: JSON.stringify({ questionId }) });
}

export function unlinkQuestionFromKnowledgePoint(id: string, questionId: string): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}/questions/${questionId}`, { method: "DELETE" });
}

export function addTagToKnowledgePoint(id: string, name: string): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}/tags`, { method: "POST", body: JSON.stringify({ name }) });
}

export function removeTagFromKnowledgePoint(id: string, tagId: string): Promise<KnowledgePointResponse> {
  return apiFetch(`/api/knowledge-points/${id}/tags/${tagId}`, { method: "DELETE" });
}

export function listKnowledgePointGroups(): Promise<KnowledgePointGroupsListResponse> {
  return apiFetch(`/api/knowledge-point-groups`);
}

export function createKnowledgePointGroup(name: string): Promise<KnowledgePointGroupResponse> {
  return apiFetch(`/api/knowledge-point-groups`, { method: "POST", body: JSON.stringify({ name }) });
}

export function renameKnowledgePointGroup(id: string, name: string): Promise<KnowledgePointGroupResponse> {
  return apiFetch(`/api/knowledge-point-groups/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteKnowledgePointGroup(id: string): Promise<void> {
  return apiFetch(`/api/knowledge-point-groups/${id}`, { method: "DELETE" });
}

export function listKnowledgePointTags(): Promise<KnowledgePointTagsListResponse> {
  return apiFetch(`/api/knowledge-point-tags`);
}

export function renameKnowledgePointTag(id: string, name: string): Promise<{ tag: KnowledgePointTag }> {
  return apiFetch(`/api/knowledge-point-tags/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteKnowledgePointTag(id: string): Promise<void> {
  return apiFetch(`/api/knowledge-point-tags/${id}`, { method: "DELETE" });
}

export function searchLinkableQuestions(params: {
  q?: string;
  examId?: string;
  knowledgePointId?: string;
  limit?: number;
  offset?: number;
}): Promise<LinkableQuestionsResponse> {
  const qs = buildQuery(params as Record<string, string | number | undefined>);
  return apiFetch(`/api/knowledge-points/linkable-questions${qs}`);
}

export interface UploadedKnowledgePointImage {
  id: string;
  url: string;
  status: "pending" | "attached" | "orphaned";
}

export function uploadKnowledgePointImage(knowledgePointId: string, file: File | Blob): Promise<{ image: UploadedKnowledgePointImage }> {
  return apiFetch(`/api/kp-images/${knowledgePointId}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

export function deleteKnowledgePointImage(id: string): Promise<void> {
  return apiFetch(`/api/kp-images/${id}`, { method: "DELETE" });
}

export function isRevisionConflict(err: unknown): err is ApiError & { body: AutosaveConflictResponse } {
  return err instanceof ApiError && err.status === 409 && (err.body as { error?: string } | null)?.error === "revision_conflict";
}
