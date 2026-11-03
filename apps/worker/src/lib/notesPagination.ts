import { NOTES_PAGE_SIZE } from "@prepdeck/shared";

interface Position { createdAt: string; id: string }

// The cursor binds the order position to the viewer and query scope. It is
// not an authorization token: every page repeats the visibility predicate.
export function parseNotesPage(limit: string | undefined, cursor: string | undefined, scope: string) {
  const size = limit === undefined ? NOTES_PAGE_SIZE : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > NOTES_PAGE_SIZE) return null;
  let after: Position | null = null;
  if (cursor !== undefined) {
    if (cursor.length > 2048) return null;
    try {
      const value = JSON.parse(decodeURIComponent(atob(cursor)));
      if (!Array.isArray(value) || value.length !== 3 || value[0] !== scope ||
          typeof value[1] !== "string" || value[1].length > 64 ||
          typeof value[2] !== "string" || value[2].length > 128) return null;
      after = { createdAt: value[1], id: value[2] };
    } catch { return null; }
  }
  return { size, after };
}

export function notesCursor(scope: string, row: { created_at: string; id: string }) {
  return btoa(encodeURIComponent(JSON.stringify([scope, row.created_at, row.id])));
}
