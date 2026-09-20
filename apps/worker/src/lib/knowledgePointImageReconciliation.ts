// implementation — on every content autosave, reconcile each attached image's
// `status` against whether its stable streaming URL is still referenced in
// the saved body_markdown. Pure so the attach/orphan/re-attach transitions
// are unit testable without a D1 binding; the route turns the result into
// two batched `UPDATE ... WHERE id IN (...)` statements.

export interface KnownKnowledgePointImage {
  id: string;
  status: "pending" | "attached" | "orphaned";
}

export interface ImageReconciliationResult {
  toAttach: string[];
  toOrphan: string[];
}

export function reconcileImageStatuses(
  bodyMarkdown: string,
  knownImages: readonly KnownKnowledgePointImage[]
): ImageReconciliationResult {
  const toAttach: string[] = [];
  const toOrphan: string[] = [];

  for (const image of knownImages) {
    const referenced = bodyMarkdown.includes(`/api/kp-images/${image.id}`);
    if (referenced && image.status !== "attached") {
      toAttach.push(image.id);
    } else if (!referenced && image.status === "attached") {
      toOrphan.push(image.id);
    }
    // A still-unreferenced 'pending' or still-unreferenced 'orphaned' image
    // needs no write — only the cleanup sweep (grace-window based) removes
    // those, never this reconciliation step.
  }

  return { toAttach, toOrphan };
}
