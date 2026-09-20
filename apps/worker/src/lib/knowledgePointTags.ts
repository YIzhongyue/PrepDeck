// implementation — normalization shared by tag creation (both the standalone
// "create a tag" path and the editor's inline "+ Create '<name>'" path) and
// group naming validation. Pure so edge cases (whitespace, a leading '#',
// length limits) are unit tested without a D1 binding. Case-insensitive
// de-duplication itself is enforced at the DB layer (a `COLLATE NOCASE`
// unique index — see migrations/0014_knowledge_points.sql), not here.

const MAX_NAME_LENGTH = 40;

// Returns null when `raw` isn't a usable name — the caller should respond
// 400. Trims surrounding whitespace, collapses internal whitespace runs,
// and strips a leading '#' (users often type tags as "#aws").
export function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let name = raw.trim();
  if (name.startsWith("#")) name = name.slice(1).trim();
  name = name.replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

// Groups don't get the leading-'#' convention (they're not hashtags), but
// share the same whitespace/length rules.
export function normalizeGroupName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}
