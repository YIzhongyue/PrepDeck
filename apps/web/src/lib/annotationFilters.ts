// implementation — "My Annotations" filter/sort. GET /api/annotations does the
// actual filtering/sorting (see apps/worker/src/lib/annotationsQuery.ts);
// this just builds the query string from the UI's local filter/sort state.

import type { MarkStyle } from "@prepdeck/shared";

export type MarkSortOrder = "asc" | "desc";

// Empty markTypes = no filter (server returns everything, same as omitting
// the param). sort="asc" is the server's default, so it's omitted too —
// keeps the default view's URL identical to today's unfiltered GET.
export function annotationsQueryString(markTypes: readonly MarkStyle[], sort: MarkSortOrder, examId?: string): string {
  const params = new URLSearchParams();
  if (examId !== undefined) params.set("examId", examId);
  if (markTypes.length) params.set("markType", markTypes.join(","));
  if (sort !== "asc") params.set("sort", sort);
  return params.toString();
}

export function isDefaultView(markTypes: readonly MarkStyle[], sort: MarkSortOrder): boolean {
  return markTypes.length === 0 && sort === "asc";
}
