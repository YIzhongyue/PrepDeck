// Tag filtering for the review lists — Bookmarks (FR-6.2) and the Wrong
// Question Book (FR-5.2). Both pages render the same `TagFilterBar`, and the
// rules live here so the two behave identically and can be tested without a
// browser.
//
// Semantics, in one place because the screens used to imply them:
//   * Availability is derived from the questions currently in the list, never
//     from the whole catalog. A tag disappears the moment its last question is
//     mastered or un-bookmarked.
//   * Selecting several tags matches any of them (OR), which is what
//     `pool()` in the store already does for practice sessions. AND would ask
//     for questions carrying every selected domain at once, which is nearly
//     always empty.
//   * A selected tag that leaves the list is dropped rather than kept as an
//     invisible filter that silently empties the page.

export interface TagFacet {
  name: string;
  count: number;
}

interface Tagged {
  tags: readonly string[];
}

// Chips are ordered by how much of the list they cover, so the ones a
// collapsed bar shows first are the ones worth filtering by. Ties break
// alphabetically to keep the order stable between renders.
export function tagFacets(questions: readonly Tagged[]): TagFacet[] {
  const counts = new Map<string, number>();
  for (const question of questions) {
    for (const tag of new Set(question.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function filterByTags<T extends Tagged>(questions: readonly T[], selected: readonly string[]): T[] {
  if (!selected.length) return questions.slice();
  const wanted = new Set(selected);
  return questions.filter((question) => question.tags.some((tag) => wanted.has(tag)));
}

// Returns the same array when nothing has to change, so a caller can use the
// result to decide whether to write state at all.
export function pruneTags(selected: readonly string[], available: readonly TagFacet[]): readonly string[] {
  const names = new Set(available.map((facet) => facet.name));
  const kept = selected.filter((tag) => names.has(tag));
  return kept.length === selected.length ? selected : kept;
}

export function matchesQuery(name: string, query: string): boolean {
  return !query || name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export interface VisibleFacets {
  shown: TagFacet[];
  // Tags a collapsed bar is holding back; 0 while expanded.
  hidden: number;
  // Unselected tags the query matched. The search never applies to the
  // selected ones, so this is what "no results" means.
  matched: number;
}

// Selected tags lead and are always shown. Neither collapsing the bar nor
// searching it for something else may hide a chip that is currently filtering
// the page: a filter the user cannot see is one they cannot undo. The search
// therefore narrows the unselected tags only, and `query` applies solely while
// expanded, since a collapsed bar has no search field.
export function visibleFacets(
  facets: readonly TagFacet[],
  selected: readonly string[],
  { expanded, limit, query = "" }: { expanded: boolean; limit: number; query?: string }
): VisibleFacets {
  const active = new Set(selected);
  const pinned = facets.filter((facet) => active.has(facet.name));
  const rest = facets.filter((facet) => !active.has(facet.name));
  const matches = expanded ? rest.filter((facet) => matchesQuery(facet.name, query)) : rest;
  const ordered = [...pinned, ...matches];
  if (expanded) return { shown: ordered, hidden: 0, matched: matches.length };
  const shown = ordered.slice(0, Math.max(limit, pinned.length));
  return { shown, hidden: facets.length - shown.length, matched: matches.length };
}
