// implementation — per-user display aliases for the three annotation "mark"
// styles (hl1/hl2/hl3). Extracted as pure helpers so validation and the
// empty-input/no-row fallback logic are unit testable without a D1
// binding; the route (routes/annotationSettings.ts) only does DB plumbing.

import { DEFAULT_MARK_ALIASES, MARK_ALIAS_MAX_LENGTH, type MarkStyle } from "@prepdeck/shared";

// null = valid; otherwise the error message to return as a 400.
export function aliasValidationError(field: string, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return `${field} must be a string`;
  if (value.trim().length > MARK_ALIAS_MAX_LENGTH) return `${field} must be ${MARK_ALIAS_MAX_LENGTH} characters or fewer`;
  return null;
}

// Empty/whitespace-only input falls back to the existing stored value, or
// the built-in default if there's no existing row yet.
export function resolveMarkAlias(input: unknown, current: string | undefined, style: MarkStyle): string {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return current ?? DEFAULT_MARK_ALIASES[style];
}
