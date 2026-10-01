// Issue #94 — questions an admin has flagged as still under review
// (questions.needs_review). Learners see them marked wherever they are shown,
// and each setup screen can leave them out of the session it builds. They are
// included by default: the option narrows a session, and a learner who never
// touches it keeps the whole bank, with every such question marked.

export const UNDER_REVIEW_NOTICE = "This question is currently under review and may contain disputed or uncertain content.";

type Reviewable = { needsReview?: boolean };

/** The questions a session may draw from, given the setup screen's choice. */
export function sessionEligible<T extends Reviewable>(questions: readonly T[], skipUnderReview: boolean): T[] {
  return skipUnderReview ? questions.filter((q) => !q.needsReview) : questions.slice();
}

export function underReviewCount(questions: readonly Reviewable[]): number {
  return questions.reduce((n, q) => n + (q.needsReview ? 1 : 0), 0);
}
