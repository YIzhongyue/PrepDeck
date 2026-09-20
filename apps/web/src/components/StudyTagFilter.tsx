import { useId, useMemo, useState } from "react";
import "./StudyTagFilter.css";

interface StudyTagFilterProps {
  questions: readonly { tags: readonly string[] }[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
}

export default function StudyTagFilter({ questions, selected, onToggle }: StudyTagFilterProps) {
  const [search, setSearch] = useState("");
  const id = useId();
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of questions) {
      for (const tag of new Set(question.tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [questions]);
  const query = search.trim().toLocaleLowerCase();
  const visible = tags.filter(({ name }) => name.toLocaleLowerCase().includes(query));

  if (!tags.length) return null;

  return (
    <section className="study-tags" aria-labelledby={`${id}-label`}>
      <div className="study-tags__heading">
        <span id={`${id}-label`}>Domains <span className="study-tags__total">{tags.length}</span></span>
        <span className="study-tags__selection">{selected.length ? `${selected.length} selected` : "All domains"}</span>
      </div>
      <input
        type="search" className="input study-tags__search" placeholder="Search domains…"
        aria-label="Search domains" aria-describedby={`${id}-hint`}
        value={search} onChange={(event) => setSearch(event.target.value)}
      />
      <p id={`${id}-hint`} className="study-tags__hint">Select one or more. Counts show questions in this bank.</p>
      <div className="study-tags__list" role="group" aria-label="Domain filters" tabIndex={0}>
        {visible.map(({ name, count }) => (
          <button
            key={name} type="button" className="study-tags__tag"
            aria-pressed={selected.includes(name)}
            aria-label={`${name}, ${count} ${count === 1 ? "question" : "questions"}`}
            onClick={() => onToggle(name)}
          >
            <span className="study-tags__name">{name}</span>
            <span className="study-tags__count" aria-hidden="true">{count}</span>
          </button>
        ))}
        {!visible.length && <p className="study-tags__empty" role="status">No domains match “{search.trim()}”.</p>}
      </div>
    </section>
  );
}
