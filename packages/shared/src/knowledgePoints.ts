// DTOs for the Knowledge Points API (implementation): personal, concept-level
// Markdown notes, distinct from docs/requirements/review-notes-and-annotations.md `notes` (question-scoped,
// optionally shared) and docs/requirements/review-notes-and-annotations.md `annotations` (span-anchored). Always
// private to the owner — no visibility/sharing concept here.

export type KnowledgePointSort = "updated" | "title" | "created" | "custom";

export interface KnowledgePointTagRef {
  id: string;
  name: string;
}

export interface KnowledgePointImageRef {
  id: string;
  url: string;
  status: "pending" | "attached" | "orphaned";
}

// A linked question that may have been deleted/archived since the link was
// made. `accessible: false` means the note keeps the link but the question
// content itself must not be shown/leaked.
export interface LinkedQuestionRef {
  questionId: string;
  accessible: boolean;
  examId?: string;
  examSlug?: string;
  externalId?: string | null;
  stemExcerpt?: string;
}

export interface KnowledgePointSummary {
  id: string;
  title: string;
  excerpt: string;
  groupId: string | null;
  groupName: string | null;
  tags: KnowledgePointTagRef[];
  linkedQuestionCount: number;
  imageCount: number;
  diagramCount: number;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePointDetail {
  id: string;
  title: string;
  bodyMarkdown: string;
  groupId: string | null;
  groupName: string | null;
  tags: KnowledgePointTagRef[];
  // implementation — true when this note carries more tags than a single detail
  // read returns (see lib/knowledgePointDetail.ts's MAX_TAGS_IN_DETAIL);
  // absent/false for the overwhelming majority of notes.
  tagsTruncated?: boolean;
  images: KnowledgePointImageRef[];
  imagesTruncated?: boolean;
  linkedQuestions: LinkedQuestionRef[];
  linkedQuestionsTruncated?: boolean;
  position: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePointResponse {
  knowledgePoint: KnowledgePointDetail;
}

export interface KnowledgePointsListResponse {
  knowledgePoints: KnowledgePointSummary[];
  total: number;
  limit: number;
  offset: number;
  orderRevision: number | null;
}

export interface CreateKnowledgePointRequest {
  groupId?: string | null;
}

export interface AutosaveKnowledgePointRequest {
  baseRevision: number;
  title: string;
  bodyMarkdown: string;
}

export interface AutosaveConflictResponse {
  error: "revision_conflict";
  latest: KnowledgePointDetail;
}

export interface ReorderKnowledgePointRequest {
  beforeId: string | null;
  expectedOrderRevision: number;
}

export interface SetKnowledgePointGroupRequest {
  groupId: string | null;
}

export interface AddKnowledgePointTagRequest {
  name: string;
}

export interface LinkKnowledgePointQuestionRequest {
  questionId: string;
}

export interface KnowledgePointGroup {
  id: string;
  name: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePointGroupsListResponse {
  groups: KnowledgePointGroup[];
  ungroupedCount: number;
}

export interface KnowledgePointGroupResponse {
  group: KnowledgePointGroup;
}

export interface CreateOrRenameKnowledgePointGroupRequest {
  name: string;
}

export interface KnowledgePointTag {
  id: string;
  name: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePointTagsListResponse {
  tags: KnowledgePointTag[];
}

export interface CreateOrRenameKnowledgePointTagRequest {
  name: string;
}

// Search results for the "Link a question" picker. Deliberately excludes
// options/correct-answer fields — this endpoint must be usable by any
// authenticated user, never leaking the answer key.
export interface LinkableQuestionSummary {
  questionId: string;
  examId: string;
  examSlug: string;
  examName: string;
  externalId: string | null;
  stemExcerpt: string;
  linked: boolean;
}

export interface LinkableQuestionsResponse {
  questions: LinkableQuestionSummary[];
  total: number;
  limit: number;
  offset: number;
}

// Knowledge Point limits, shared by the REST routes and the User MCP tools.
export const KNOWLEDGE_POINT_MAX_TITLE_LENGTH = 200;
export const KNOWLEDGE_POINT_MAX_BODY_LENGTH = 200_000;
