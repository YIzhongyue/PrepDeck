// implementation — grace-window decision for the scheduled sweep that deletes
// abandoned Knowledge Point image uploads (see
// scheduled/cleanupKnowledgePointImages.ts). Pure so the window logic is
// unit testable without a D1/R2 binding.

export const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

export type KnowledgePointImageStatus = "pending" | "attached" | "orphaned";

// An 'attached' image is still referenced by a saved note and must never be
// swept, regardless of age. 'pending'/'orphaned' images become eligible only
// once they've sat unreferenced for at least the grace window, so a user
// mid-edit (pasted an image, hasn't saved yet) never loses it out from under
// them.
export function isEligibleForCleanup(
  status: KnowledgePointImageStatus,
  updatedAt: string,
  now: number,
  graceMs: number = CLEANUP_GRACE_MS
): boolean {
  if (status !== "pending" && status !== "orphaned") return false;
  return now - new Date(updatedAt).getTime() >= graceMs;
}
