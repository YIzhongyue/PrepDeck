// implementation — fractional-index positioning for Knowledge Points' "Custom
// order" (drag/keyboard reorder). A move only ever rewrites the moved row:
// its new position is the midpoint between its new neighbors' positions,
// so the rest of the scope never needs to shift. `rebalancePositions` is the
// fallback for when repeated inserts exhaust float precision between two
// neighbors (their midpoint would no longer be strictly between them).

export const POSITION_GAP = 1024;

// implementation — knowledge_point_order_scopes.scope_key sentinel for the virtual
// "Ungrouped" scope (group_id IS NULL), which — like every other Knowledge
// Points table — never gets a real row of its own. A real group's scope key
// is just its id.
export const UNGROUPED_SCOPE_KEY = "__ungrouped__";

export function scopeKeyFor(groupId: string | null): string {
  return groupId ?? UNGROUPED_SCOPE_KEY;
}

// Returns null when prev/next are too close for a distinct midpoint to
// exist — the caller should rebalance the whole scope and retry once.
export function computeMidpointPosition(prevPosition: number | null, nextPosition: number | null): number | null {
  if (prevPosition == null && nextPosition == null) return POSITION_GAP;
  if (prevPosition == null) return nextPosition! - POSITION_GAP;
  if (nextPosition == null) return prevPosition + POSITION_GAP;
  const mid = prevPosition + (nextPosition - prevPosition) / 2;
  if (mid <= prevPosition || mid >= nextPosition) return null;
  return mid;
}

export interface PositionedRow {
  id: string;
}

// Re-spaces an already-ordered list evenly, preserving relative order.
export function rebalancePositions<T extends PositionedRow>(orderedRows: readonly T[]): Array<T & { position: number }> {
  return orderedRows.map((row, index) => ({ ...row, position: (index + 1) * POSITION_GAP }));
}
