// implementation — per-user display aliases for the three annotation "mark"
// styles (hl1/hl2/hl3). The empty-input/no-row fallback is a pure helper so
// it is unit testable without a D1 binding; the request body itself is
// checked by updateAnnotationSettingsRequestSchema (@prepdeck/shared/schemas),
// and the route (routes/annotationSettings.ts) only does DB plumbing.

import { DEFAULT_MARK_ALIASES, type MarkStyle } from "@prepdeck/shared";

// Empty/whitespace-only input falls back to the existing stored value, or
// the built-in default if there's no existing row yet.
export function resolveMarkAlias(input: unknown, current: string | undefined, style: MarkStyle): string {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return current ?? DEFAULT_MARK_ALIASES[style];
}
