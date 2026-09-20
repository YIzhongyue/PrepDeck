import { useEffect, useId, useRef, useState } from "react";
import { IMPORT_LIMITS, normalizeTagKey, normalizeTagName } from "@prepdeck/shared";
import { listQuestionTags } from "../lib/questionTags";
import "./QuestionTagPicker.css";

// Saving a canonical leading # requires one extra # at the API boundary.
const fitsTagLimit = (name: string) => name.length + Number(name.startsWith("#")) <= IMPORT_LIMITS.maxTagLength;

export default function QuestionTagPicker({ tags, onAdd, onRemove, invalid }: {
  tags: string[]; onAdd: (name: string) => void; onRemove: (name: string) => void; invalid: boolean;
}) {
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    listQuestionTags(controller.signal)
      .then(names => { if (!controller.signal.aborted) setCatalog(names); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  const name = normalizeTagName(query);
  const key = name ? normalizeTagKey(name) : "";
  const selected = new Set(tags.map(normalizeTagKey));
  const atLimit = tags.length >= IMPORT_LIMITS.maxTags;
  const exactMatch = catalog.some(tag => normalizeTagKey(tag) === key);
  const suggestions = catalog.filter(tag => !selected.has(normalizeTagKey(tag)) && (!key || normalizeTagKey(tag).includes(key)));
  const canCreate = !!name?.trim() && fitsTagLimit(name!) && !exactMatch && !selected.has(key);
  const options = suggestions.map(tag => ({ name: tag, create: false }));
  if (canCreate) options.push({ name: name!, create: true });
  const activeIndex = Math.min(active, options.length - 1);
  const inputError = query.trim() && (!name || !fitsTagLimit(name)) ? `Enter a tag name of 1–${IMPORT_LIMITS.maxTagLength} characters.` : "";

  const add = (tag: string) => {
    if (atLimit || !fitsTagLimit(tag) || selected.has(normalizeTagKey(tag))) return;
    onAdd(tag);
    setQuery(""); setActive(0); setOpen(true);
    input.current?.focus();
  };
  const activate = (index: number) => {
    setActive(index);
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
  };

  return <div className="question-tags" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }}>
    {tags.length > 0 && <ul className="question-tags__selected" aria-label="Selected tags">
      {tags.map(tag => <li key={tag} className="question-tags__chip">
        <span>{tag}</span>
        <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => {
          onRemove(tag); input.current?.focus();
        }}>×</button>
      </li>)}
    </ul>}
    <input ref={input} id="question-tags" className="input" role="combobox" autoComplete="off"
      value={query} placeholder="Search or create a tag…" aria-autocomplete="list"
      aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
      aria-invalid={invalid || !!inputError} aria-describedby={`error-tags ${id}-hint ${id}-status`}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); setOpen(true);
          if (options.length) activate(!open ? 0 : (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const option = options[activeIndex];
          if (open && option) add(option.name);
          else setOpen(true);
        }
      }} />
    {open && <div className="question-tags__options" role="listbox" id={`${id}-list`} aria-label="Available tags">
      {options.map((option, index) => <button type="button" role="option" tabIndex={-1}
        id={`${id}-option-${index}`} key={option.name} aria-selected={index === activeIndex}
        disabled={atLimit || !fitsTagLimit(option.name)} onPointerDown={e => e.preventDefault()}
        onClick={() => add(option.name)} onPointerMove={() => setActive(index)}>
        {option.create ? `Create “${option.name}”` : option.name}
      </button>)}
      {options.length === 0 && <div className="question-tags__empty">
        {selected.has(key) ? "This tag is already selected." : loading ? "Loading tags…" : "No matching tags. Type a name to create one."}
      </div>}
    </div>}
    <p id={`${id}-hint`} className="question-tags__hint">Select an existing tag or create one. Changes are saved with the question.</p>
    <div id={`${id}-status`} role="status" className="question-tags__status">
      {inputError && <span className="authoring-errors">{inputError}</span>}
      {atLimit && <span>Up to {IMPORT_LIMITS.maxTags} tags per question. Remove a tag to add another.</span>}
      {failed && <span>Could not load tags. You can still edit this question. <button type="button" className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>Retry tags</button></span>}
    </div>
  </div>;
}
