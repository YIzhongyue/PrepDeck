import { useId, useMemo, useState, type ReactNode } from "react";
import type { StudyStatusFilter } from "@prepdeck/shared";
import PageBreadcrumb from "../PageBreadcrumb";
import { STUDY_FILTERS } from "../../lib/studyStatus";
import type { ScreenId } from "../../types";
import { IC, Icon } from "./StudyKit";
import "./setup.css";

// Shared pieces of the Practice, Mock and Learning setup screens. Styles live in
// setup.css, on the `.pd-study` tokens from study.css.

export interface SetupLayout {
  /** Label column beside each row, or stacked above it. */
  rowCols: string;
  /** Settings beside the summary card, or stacked above it. */
  setupCols: string;
  /** Two cards per row, or one. */
  cardCols: string;
  stickySummary: boolean;
}

// Mirrors the design's breakpoints: the summary card leaves the side at 1240px,
// row labels move on top at 1000px and cards go single-column at 820px (or
// sooner, when their column is too narrow for two).
export function setupLayout(width: number, phone: boolean): SetupLayout {
  return {
    rowCols: phone || width < 1000 ? "minmax(0, 1fr)" : "192px minmax(0, 1fr)",
    setupCols: phone || width < 1240 ? "minmax(0, 1fr)" : "minmax(0, 1fr) 340px",
    // At most two per row, and only while each keeps 240px: beside the summary
    // card a two-up row is narrow enough to break "Unattempted" mid-word.
    cardCols: phone || width < 820 ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(max(240px, calc((100% - 12px) / 2)), 1fr))",
    stickySummary: !phone && width >= 1240
  };
}

export function SetupHeader({ screen, title, children }: { screen: ScreenId; title: string; children: ReactNode }) {
  return (
    <header className="st-setup-head">
      <PageBreadcrumb screen={screen} />
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

export function SetupRow({ title, desc, cols, children }: { title: string; desc?: string; cols: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="st-row" style={{ gridTemplateColumns: cols }} aria-labelledby={id}>
      <div className="st-row-label">
        <div id={id} className="st-row-title">{title}</div>
        {desc && <div className="st-row-desc">{desc}</div>}
      </div>
      <div className="st-row-body">{children}</div>
    </section>
  );
}

/* A radio-style card. The accessible name is `label` plus the optional count,
   so a card reads "Bookmarked 4" and its description is announced separately. */
export function ChoiceCard({ icon, label, count, desc, on, onSelect }: {
  icon: string; label: string; count?: number; desc: string; on: boolean; onSelect: () => void;
}) {
  const descId = useId();
  return (
    <button
      type="button" className="st-choice" aria-pressed={on} onClick={onSelect} data-empty={count === 0 || undefined}
      aria-label={count == null ? label : `${label} ${count}`} aria-describedby={descId}
    >
      <span className="st-choice-tile"><Icon d={icon} size={18} /></span>
      <span className="st-choice-main">
        <span className="st-choice-label">{label}{count != null && <span className="st-choice-count">{count}</span>}</span>
        <span id={descId} className="st-choice-desc">{desc}</span>
      </span>
      <span className="st-radio" aria-hidden="true" />
    </button>
  );
}

/**
 * Issue #94: whether questions still under review may appear in the session.
 * Including them is the default; each one is then marked as under review.
 * Renders nothing for a bank without any, where the choice would change nothing.
 */
export function UnderReviewRow({ count, skip, onChange, layout }: {
  count: number; skip: boolean; onChange: (skip: boolean) => void; layout: SetupLayout;
}) {
  if (!count) return null;
  const some = count === 1 ? "1 question in this exam is" : `${count} questions in this exam are`;
  return (
    <SetupRow title="Questions under review" desc={`${some} still being reviewed and may contain disputed or uncertain content.`} cols={layout.rowCols}>
      <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
        <ChoiceCard icon={IC.alert} label="Include" count={count} desc="They can appear, each marked as under review" on={!skip} onSelect={() => onChange(false)} />
        <ChoiceCard icon={IC.eyeOff} label="Skip" desc="Leave them out of this session" on={skip} onSelect={() => onChange(true)} />
      </div>
    </SetupRow>
  );
}

const STUDY_ICONS: Record<StudyStatusFilter, string> = { all: IC.library, unstudied: IC.circleDot, studied: IC.circleCheck };

/**
 * Issue #119: All questions / Unstudied only / Studied only. Studied means
 * shown in Learning or answered in Practice or Mock; it is not mastery, and it
 * combines with every other filter on the screen.
 */
export function StudyStatusRow({ value, counts, onChange, layout, unavailable = false }: {
  value: StudyStatusFilter; counts: Record<StudyStatusFilter, number>; onChange: (filter: StudyStatusFilter) => void; layout: SetupLayout;
  /** The statuses failed to load, so the counts may treat studied questions as unstudied. */
  unavailable?: boolean;
}) {
  return (
    <SetupRow title="Study status" desc="Studied means shown in Learning or answered in Practice or Mock, not mastered." cols={layout.rowCols}>
      {unavailable && (
        <p className="st-start-hint" role="status">Your study status could not be loaded, so questions may show as unstudied. Refresh the exam to try again.</p>
      )}
      <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
        {STUDY_FILTERS.map((f) => (
          <ChoiceCard key={f.id} icon={STUDY_ICONS[f.id]} label={f.label} count={counts[f.id]} desc={f.desc} on={value === f.id} onSelect={() => onChange(f.id)} />
        ))}
      </div>
    </SetupRow>
  );
}

/**
 * Settings most sessions leave alone, folded under one row that names their
 * current values, so the setup reads as "source, count, start". Starts open
 * when any of them is already changed, so a choice is never hidden.
 */
export function MoreOptions({ summary, defaultOpen, cols, children }: { summary: string; defaultOpen: boolean; cols: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className="st-more-opts">
      <div className="st-row st-more-row" style={{ gridTemplateColumns: cols }}>
        <div className="st-row-label">
          <div className="st-row-title">More options</div>
          <div className="st-row-desc">Optional. The defaults suit most sessions.</div>
        </div>
        <div className="st-row-body">
          <button type="button" className="st-more-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
            <span className="st-more-summary">{summary}</span>
            <span className="st-more-action">{open ? "Hide" : "Customize"}<Icon d={IC.chevDown} size={16} strokeWidth={2.25} /></span>
          </button>
        </div>
      </div>
      <div id={bodyId} className="st-more-body" hidden={!open}>{children}</div>
    </div>
  );
}

/**
 * Why a setup has nothing to start, and the nearest choice that does. Shown in
 * the summary card in place of an enabled start button, so selecting an empty
 * source is never a dead end (design review, 4 October 2026).
 */
export function EmptyPoolNotice({ id, title, body, action }: {
  id: string; title: string; body: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <div id={id} className="st-summary-empty">
      <span className="st-summary-empty-icon"><Icon d={IC.info} size={16} /></span>
      <div className="st-summary-empty-text">
        <div className="st-summary-empty-title">{title}</div>
        <div>{body}</div>
        {action && (
          <button type="button" className="st-link st-link--brand" onClick={action.onClick}>
            {action.label}<Icon d={IC.arrowRight} size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function SummaryRow({ icon, label, value }: { icon: string; label: string; value: ReactNode }) {
  return (
    <div className="st-summary-row">
      <span><Icon d={icon} />{label}</span>
      <span>{value}</span>
    </div>
  );
}

const DIFF_LEVEL = { all: 0, easy: 1, medium: 2, hard: 3 } as const;
export type DifficultyChoice = keyof typeof DIFF_LEVEL;
const DIFF_OPTS: { id: DifficultyChoice; label: string }[] = [
  { id: "all", label: "Any" }, { id: "easy", label: "Easy" }, { id: "medium", label: "Medium" }, { id: "hard", label: "Hard" }
];

export function DifficultyPicker({ value, counts, onChange }: { value: DifficultyChoice; counts: Record<DifficultyChoice, number>; onChange: (d: DifficultyChoice) => void }) {
  return (
    <div className="st-diffs" role="group" aria-label="Difficulty">
      {DIFF_OPTS.map((o) => {
        const level = DIFF_LEVEL[o.id];
        return (
          <button key={o.id} type="button" className="st-diff" aria-pressed={value === o.id} aria-label={o.label} onClick={() => onChange(o.id)}>
            <span className="st-diff-bars" aria-hidden="true">
              {[6, 10, 14].map((h, j) => <span key={h} style={{ height: h }} data-on={level === 0 || j < level} />)}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="st-diff-label">{o.label}</span>
              <span className="st-diff-count">{counts[o.id]} {counts[o.id] === 1 ? "question" : "questions"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Past this many domains the picker adds search and folds to two rows.
const BIG_DOMAIN_SET = 12;

export function tagCounts(questions: readonly { tags: readonly string[] }[]) {
  const counts = new Map<string, number>();
  for (const question of questions) for (const tag of new Set(question.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/* Short text for a summary: "All", "A, B" or "A, B +3". */
export function domainSummary(selected: readonly string[]) {
  if (!selected.length) return "All";
  return selected.length <= 2 ? selected.join(", ") : `${selected.slice(0, 2).join(", ")} +${selected.length - 2}`;
}

/**
 * Domain chips with search. Searching only changes which chips show; "Select
 * all results" replaces the selection with every match (the Practice behaviour
 * the domain browser tests pin down), and chips still toggle one at a time.
 * Leave out `onSelectResults` or `onClear` to drop that action; Learning
 * keeps Clear but not "Select all results".
 */
export function DomainPicker({ questions, selected, onToggle, onSelectResults, onClear, phone }: {
  questions: readonly { tags: readonly string[] }[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
  onSelectResults?: (tags: string[]) => void;
  onClear?: () => void;
  phone: boolean;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const hintId = useId();
  const tags = useMemo(() => tagCounts(questions), [questions]);
  const query = search.trim().toLocaleLowerCase();
  const visible = query ? tags.filter(({ name }) => name.toLocaleLowerCase().includes(query)) : tags;
  const big = tags.length > BIG_DOMAIN_SET;
  const collapsed = big && !query && !expanded;
  const selectedQuestions = useMemo(
    () => (selected.length ? questions.filter((q) => q.tags.some((t) => selected.includes(t))).length : 0),
    [questions, selected]
  );

  if (!tags.length) return <p className="st-muted">This exam has no domains yet.</p>;

  return (
    <>
      {big && (
        <label className="st-search">
          <Icon d={IC.search} size={18} />
          <input
            type="search" placeholder={`Search ${tags.length} domains`} aria-label="Search domains"
            aria-describedby={query && onSelectResults ? hintId : undefined}
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          {!!search && (
            <button type="button" className="st-search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              <Icon d={IC.x} size={14} />
            </button>
          )}
        </label>
      )}
      <div className="st-chips-wrap" style={{ maxHeight: collapsed ? (phone ? 148 : 80) : undefined }}>
        <div className="st-chips" role="group" aria-label="Domain filters">
          {visible.map(({ name, count }) => (
            <button
              key={name} type="button" className="st-chip" aria-pressed={selected.includes(name)}
              aria-label={`${name}, ${count} ${count === 1 ? "question" : "questions"}`}
              onClick={() => onToggle(name)}
            >
              <span className="st-chip-name">{name}</span>
              <span className="st-chip-count" aria-hidden="true">{count}</span>
              <span className="st-chip-check" aria-hidden="true"><Icon d={IC.check} size={14} strokeWidth={3} /></span>
            </button>
          ))}
        </div>
        {collapsed && <span className="st-chips-fade" />}
      </div>
      {query && !visible.length && (
        <div className="st-chip-empty" role="status"><Icon d={IC.search} />No domains match “{search.trim()}”.</div>
      )}
      {(big || selected.length > 0) && (
        <div className="st-chip-bar">
          {big && !query && (
            <button type="button" className="st-link st-link--brand st-more" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show fewer" : `Show all ${tags.length} domains`}<Icon d={IC.chevDown} size={14} strokeWidth={2.25} />
            </button>
          )}
          {query && onSelectResults && (
            <button
              type="button" className="st-link st-link--brand st-bulk" disabled={!visible.length} aria-describedby={hintId}
              onClick={() => { if (visible.length) onSelectResults(visible.map(({ name }) => name)); }}
            >
              <Icon d={IC.check} size={14} />Select all results ({visible.length})
            </button>
          )}
          <span className="st-spacer" />
          {selected.length > 0 && (
            <span className="st-chip-sel">
              <span>{selected.length} selected · {selectedQuestions} {selectedQuestions === 1 ? "question" : "questions"}</span>
              {onClear && <button type="button" className="st-link" onClick={onClear}><Icon d={IC.x} size={14} />Clear</button>}
            </span>
          )}
        </div>
      )}
      {query && onSelectResults && <span id={hintId} className="sr-only">Select all results replaces your current domain selection.</span>}
    </>
  );
}
