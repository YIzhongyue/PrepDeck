import { useEffect, useId, useState } from "react";
import { tagFacets, visibleFacets } from "../lib/tagFilter";
import { useI18n } from "../i18n";
import "./TagFilterBar.css";

// The tag filter shared by Bookmarks and the Wrong Question Book. Both lists
// can carry dozens of tags, so the bar stays one or two rows tall by default
// and everything past `COLLAPSED_LIMIT` lives behind "More" — everything, that
// is, except the chips currently filtering the page, which neither collapsing
// nor searching may take away. See `lib/tagFilter.ts` for the rules.
//
// The setup screens' `DomainPicker` (components/study/SetupKit.tsx) is the same
// idea for Practice and Learning: it filters the whole catalog before a session
// starts. This one sits above a result list, reports what the filter is doing
// to that list, and is collapsible.

const COLLAPSED_LIMIT = 6;
// Below this, "More" reveals every remaining chip in one row or two and a
// search field would be slower than reading them.
const SEARCH_THRESHOLD = 12;

interface TagFilterBarProps {
  // The unfiltered list. Counts and availability follow it, so a tag leaves
  // the bar as soon as its last question does.
  questions: readonly { tags: readonly string[] }[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  // Questions the current selection matches, out of `questions.length`.
  resultCount: number;
  label?: string;
}

export default function TagFilterBar({ questions, selected, onToggle, onClear, resultCount, label: labelProp }: TagFilterBarProps) {
  const { t } = useI18n();
  const label = labelProp ?? t("tagFilter.label");
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const facets = tagFacets(questions);
  const searchable = facets.length >= SEARCH_THRESHOLD;
  const { shown, hidden, matched } = visibleFacets(facets, selected, { expanded, limit: COLLAPSED_LIMIT, query: searchable ? query : "" });
  // Selected chips stay put while searching, so an empty result is about the
  // tags the search could reach, not about the chips on screen.
  const noMatches = expanded && searchable && !!query.trim() && !matched;

  // A list that shrinks past the threshold (mastering questions, removing
  // bookmarks) leaves no way back to a collapsed bar, so drop the expansion
  // and its query rather than stranding a filtered view of four chips.
  useEffect(() => {
    if (facets.length <= COLLAPSED_LIMIT) { setExpanded(false); setQuery(""); }
  }, [facets.length]);

  if (!facets.length) return null;

  const collapse = () => { setExpanded(false); setQuery(""); };

  return (
    <section className="tag-filter" aria-labelledby={`${id}-label`}>
      <div className="tag-filter__header">
        <span className="tag-filter__label" id={`${id}-label`}>{label}</span>
        <span className="tag-filter__status" role="status">
          {selected.length
            ? `${t("tagFilter.resultOf", { n: resultCount, count: questions.length })} · ${t("tagFilter.tagsSelected", { count: selected.length })}`
            : `${t("setup.questions", { count: questions.length })} · ${t("tagFilter.allTags")}`}
        </span>
        {selected.length > 0 && (
          <button type="button" className="tag-filter__clear" onClick={onClear}>{t("tagFilter.clear")}</button>
        )}
      </div>

      {expanded && searchable && (
        <input
          type="search" className="input tag-filter__search" value={query}
          placeholder={t("tagFilter.searchPlaceholder")} aria-label={t("tagFilter.search")} aria-describedby={`${id}-hint`}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
        />
      )}

      <div className={`tag-filter__chips${expanded ? " tag-filter__chips--expanded" : ""}`} id={`${id}-chips`} role="group" aria-label={label}>
        {shown.map((facet) => {
          const on = selected.indexOf(facet.name) >= 0;
          return (
            <button
              key={facet.name} type="button" className="tag-filter__chip" aria-pressed={on}
              aria-label={`${facet.name} ${t("setup.questions", { count: facet.count })}`}
              onClick={() => onToggle(facet.name)}
            >
              <svg className="tag-filter__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 13l4 4 10-10" />
              </svg>
              <span className="tag-filter__name">{facet.name}</span>
              <span className="tag-filter__count" aria-hidden="true">{facet.count}</span>
            </button>
          );
        })}

        {noMatches && (
          <p className="tag-filter__empty">
            {t(selected.length ? "tagFilter.noOtherMatch" : "tagFilter.noMatch", { query: query.trim() })}
          </p>
        )}
      </div>

      {/* Outside the chip box: expanded it scrolls, and the way back out of a
          fifty-tag list must not scroll away with it. */}
      {(hidden > 0 || expanded) && (
        <button
          type="button" className="tag-filter__more" aria-expanded={expanded} aria-controls={`${id}-chips`}
          onClick={() => (expanded ? collapse() : setExpanded(true))}
        >
          {expanded ? t("setup.domains.showFewer") : t("tagFilter.showMore", { count: hidden })}
        </button>
      )}

      {expanded && searchable && (
        <p id={`${id}-hint`} className="tag-filter__hint">{t("tagFilter.hint")}</p>
      )}
    </section>
  );
}
