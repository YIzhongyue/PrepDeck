// Issue #119 — per-user, per-question studied status. "Studied" means the
// user has been exposed to the question (shown it in Learning, or recorded a
// real answer in Practice or Mock); it is not mastery and not correctness, and
// it is independent of the Learning resume position (learning.ts) and of
// "attempted" (PracticeCatalogResponse.attemptedIds).

export type QuestionStudyStatus = "studied" | "unstudied";

// The setup screens' three-way filter. "all" ignores the status.
export type StudyStatusFilter = "all" | "unstudied" | "studied";

export interface QuestionStudyStatusEntry {
  questionId: string;
  status: QuestionStudyStatus;
  // Moves on every change. A client keeps the entry with the highest revision
  // it has seen, and sends it back with Learning's automatic mark so a stale
  // visit cannot override a newer reset.
  revision: number;
  // Null only for a question with no entry yet.
  updatedAt: string | null;
}

// GET /api/exams/:examId/study-status — every recorded status for this user's
// questions in the exam. A question with no entry is unstudied (revision 0).
export interface StudyStatusListResponse {
  examId: string;
  statuses: QuestionStudyStatusEntry[];
}

// PUT /api/exams/:examId/study-status/:questionId — an explicit choice from the
// UI ("Mark as unstudied" / "Mark as studied"). Always applies.
export interface SetStudyStatusRequest {
  status: QuestionStudyStatus;
}

// POST /api/exams/:examId/study-status/:questionId/learning-view — the
// automatic mark when Learning has displayed the question. Applies only while
// the stored revision still equals expectedRevision (0 = no entry yet).
export interface LearningViewRequest {
  expectedRevision: number;
}

export interface StudyStatusMutationResponse {
  // False when an automatic mark was refused because the status moved since
  // the client last saw it; `status` is then the current, unchanged entry.
  applied: boolean;
  status: QuestionStudyStatusEntry;
}

/** The entry the client should keep: the newer of the two by revision. */
export function newerStudyStatus(
  current: QuestionStudyStatusEntry | undefined, incoming: QuestionStudyStatusEntry,
): QuestionStudyStatusEntry {
  return !current || incoming.revision > current.revision ? incoming : current;
}

export function isStudied(entry: { status: QuestionStudyStatus } | undefined): boolean {
  return entry?.status === "studied";
}

export function matchesStudyFilter(filter: StudyStatusFilter, studied: boolean): boolean {
  return filter === "all" || (filter === "studied") === studied;
}
