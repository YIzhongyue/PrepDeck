import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CURATED_MODELS } from "@prepdeck/shared";
import { usePrepDeck } from "../../store/PrepDeckContext";
import QuestionContent from "../QuestionContent";
import MarkdownHighlightedText from "../MarkdownHighlightedText";
import NoteCard from "../NoteCard";
import UnlockKeyPrompt from "../UnlockKeyPrompt";
import AnswerRevisionNotice from "../AnswerRevisionNotice";
import type { LearningHistoryRow, Question } from "../../types";
import "./study.css";

// Shared pieces of the live Practice, Mock and Learning screens. Styles live
// in study.css under `.pd-study`.

/* Lucide paths (ISC), as used by the study-modes design. */
export const IC = {
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  sparkles: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z M20 3v4 M22 5h-4",
  rotate: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
  bookmark: "M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",
  listChecks: "M3 17l2 2 4-4 M3 7l2 2 4-4 M13 6h8 M13 12h8 M13 18h8",
  timer: "M10 2h4 M12 14l3-3 M4 14a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
  timerOff: "M10 2h4 M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7 M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2 M2 2l20 20 M12 12v-2",
  bookOpen: "M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
  history: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2",
  msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M13 8H7 M17 12H7",
  lightbulb: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5 M9 18h6 M10 22h4",
  circleCheck: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M9 12l2 2 4-4",
  circleX: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M15 9l-6 6 M9 9l6 6",
  circleDot: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z",
  tag: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z M7.5 7.5h.01",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 6v6l4 2",
  target: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z",
  trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2z",
  lock: "M7 11h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  keyboard: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M10 8h.01 M12 12h.01 M14 8h.01 M16 12h.01 M18 8h.01 M6 8h.01 M7 16h10 M8 12h.01",
  badgeCheck: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76z M9 12l2 2 4-4",
  refresh: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5",
  send: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z M21.854 2.147l-10.94 10.939",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  squarePen: "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
  chevLeft: "M15 18l-6-6 6-6",
  chevRight: "M9 18l6-6-6-6",
  chevDown: "m6 9 6 6 6-6",
  library: "M16 6l4 14 M12 6v14 M8 8v12 M4 4v16",
  zap: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  fileText: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z M14 2v4a2 2 0 0 0 2 2h4 M10 9H8 M16 13H8 M16 17H8",
  hourglass: "M5 22h14 M5 2h14 M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22 M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",
  sliders: "M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4",
  shuffle: "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22 M18 2l4 4-4 4 M2 6h1.9c1.5 0 2.9.9 3.6 2.2 M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8 M18 14l4 4-4 4",
  eyeOff: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49 M14.084 14.158a3 3 0 0 1-4.242-4.242 M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143 M2 2l20 20",
  server: "M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z M6 6h.01 M6 18h.01",
  save: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7 M7 3v4a1 1 0 0 0 1 1h7",
  search: "M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M21 21l-4.3-4.3",
  listOrdered: "M10 12h11 M10 18h11 M10 6h11 M4 10h2 M4 6h1v4 M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  play: "M6 3.9a1 1 0 0 1 1.5-.86l12 7.1a1 1 0 0 1 0 1.72l-12 7.1A1 1 0 0 1 6 18.1z",
  arrowRight: "M5 12h14 M12 5l7 7-7 7",
  info: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 16v-4 M12 8h.01"
} as const;

export function Icon({ d, size = 16, strokeWidth = 2, fill = "none", style }: { d: string; size?: number; strokeWidth?: number; fill?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}

export function modelLabelFor(provider: "anthropic" | "openai", modelId: string): string {
  return CURATED_MODELS[provider].find((m) => m.id === modelId)?.label ?? modelId;
}

export function BookmarkButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`st-btn st-btn--icon${on ? " st-btn--on" : ""}`} onClick={onClick} title="Bookmark" aria-label="Bookmark" aria-pressed={on}>
      <Icon d={IC.bookmark} size={18} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

export function CopyPromptButton({ status, onClick }: { status: "idle" | "copied" | "error"; onClick: () => void }) {
  return (
    <>
      <button type="button" className="st-btn st-btn--sm st-copy" onClick={onClick} aria-label="Copy question and answers as a Markdown prompt">
        <Icon d={status === "copied" ? IC.check : IC.copy} style={status === "copied" ? { animation: "st-pop .35s cubic-bezier(.3,1.5,.5,1) both" } : undefined} />
        {status === "copied" ? "Copied" : status === "error" ? "Copy failed" : "Copy as prompt"}
      </button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? "Markdown prompt copied to clipboard." : status === "error" ? "Could not copy the Markdown prompt." : ""}
      </span>
    </>
  );
}

/* The question's id, type and domain badges, with an optional trailing action. */
export function QuestionBadges({ label, typeLabel, multi, tags, children }: { label: string | null; typeLabel: string; multi: boolean; tags?: string[]; children?: ReactNode }) {
  return (
    <div className="st-badges">
      {label && <span className="st-badge st-q-id">{label}</span>}
      <span className="st-badge st-badge--brand"><Icon d={multi ? IC.listChecks : IC.circleDot} size={12} />{typeLabel}</span>
      {tags?.map((t) => <span key={t} className="st-badge st-badge--info"><Icon d={IC.tag} size={12} />{t}</span>)}
      {children}
    </div>
  );
}

export type OptionState = "idle" | "selected" | "correct" | "wrong" | "dim";

/* One answer option. Interactive rows (onPick set) behave as buttons. */
export function OptionRow({ id, state, status, keyHint, onPick, onMouseUp, children }: {
  id: string;
  state: OptionState;
  status?: string;
  keyHint?: string;
  onPick?: () => void;
  onMouseUp?: () => void;
  children: ReactNode;
}) {
  const mark = state === "correct" ? <Icon d={IC.check} size={14} strokeWidth={3} /> : state === "wrong" ? <Icon d={IC.x} size={14} strokeWidth={3} /> : id;
  return (
    <div
      className="st-opt"
      data-state={state}
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-pressed={onPick ? state === "selected" : undefined}
      onClick={onPick}
      onKeyDown={onPick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } } : undefined}
      onMouseUp={onMouseUp}
    >
      <span className="st-opt-mark">{mark}</span>
      <span className="st-opt-main">
        <span>{children}</span>
        {status && <span className="st-opt-status">{status}</span>}
      </span>
      {keyHint && <span className="st-opt-key" aria-hidden="true">{keyHint}</span>}
    </div>
  );
}

/* Clips long content behind "Show more" — only where the column has no
   scroller of its own (phones and short windows); a bounded desktop panel
   already scrolls, so clipping there would just hide text. */
export function Collapsible({ cap, enabled, children }: { cap: number; enabled: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !enabled) { setLong(false); return; }
    const measure = () => setLong(el.scrollHeight > cap + 24);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, cap]);
  const clipped = enabled && long && !open;
  return (
    <div>
      <div className="st-collapse-body" style={{ maxHeight: clipped ? cap : undefined }}>
        <div ref={inner}>{children}</div>
        {clipped && <span className="st-collapse-fade" />}
      </div>
      {enabled && long && (
        <button type="button" className="st-link st-link--brand st-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}<Icon d={IC.chevDown} size={14} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}

export interface ReviewTab { key: string; label: string; icon: string; count?: number }

/* The graded / reading review card: a tab strip over one panel. */
export function ReviewTabs({ tabs, active, onChange, children }: { tabs: ReviewTab[]; active: string; onChange: (key: string) => void; children: ReactNode }) {
  return (
    <div className="st-card st-review">
      <div className="st-tabs" role="tablist" aria-label="Review">
        {tabs.map((t) => (
          <button
            key={t.key} type="button" role="tab" id={`st-tab-${t.key}`} aria-selected={t.key === active} aria-controls="st-tabpanel"
            className="st-tab" onClick={() => onChange(t.key)}
          >
            <Icon d={t.icon} />{t.label}
            {!!t.count && <span className="st-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="st-tabpanel" aria-labelledby={`st-tab-${active}`}>{children}</div>
    </div>
  );
}

/* Official explanation, then the AI explanation with its cache / generate states. */
export function ExplanationPanel({ q, explanation, collapsible }: { q: Question; explanation?: string | null; collapsible: boolean }) {
  const { state, genAi, useAlternateAi, capture, removeMark } = usePrepDeck();
  const aiRec = state.ai[q.id];
  const providerLabel = state.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const modelLabel = modelLabelFor(state.provider, state.model);
  const ready = aiRec?.status === "ready";
  const badge = ready && aiRec.provider && aiRec.model
    ? `${aiRec.cached ? "cached" : "generated"} · ${modelLabelFor(aiRec.provider, aiRec.model)}`
    : "not cached";

  return (
    <div className="st-panel">
      {!!explanation && (
        <div className="st-official">
          <div className="st-official-title"><Icon d={IC.badgeCheck} size={14} />Official explanation</div>
          <Collapsible cap={110} enabled={collapsible}>
            <div className="st-prose"><QuestionContent src={explanation} /></div>
          </Collapsible>
        </div>
      )}

      <div className="st-ai-head">
        <span className="st-ai-title"><Icon d={IC.sparkles} />AI explanation</span>
        <span className={`st-badge${ready ? " st-badge--ok" : ""}`}>{badge}</span>
      </div>

      {ready && (
        <>
          <Collapsible cap={198} enabled={collapsible}>
            <div className="st-prose">
              <MarkdownHighlightedText
                src={aiRec.content ?? ""} annotations={state.anns} qid={q.id} target="ai" show
                onMouseUp={() => capture(q.id, "ai")}
                onRemoveMark={removeMark}
              />
            </div>
          </Collapsible>
          {aiRec.canManage && (
            <button type="button" className="st-link" onClick={() => genAi(q, true)}><Icon d={IC.refresh} size={14} />Regenerate</button>
          )}
        </>
      )}

      {(!aiRec || aiRec.status === "checking" || aiRec.status === "generating") && (
        <span className="st-spin">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 3a9 9 0 019 9" /></svg>
          <span>{aiRec?.status === "generating" ? `Relaying to ${providerLabel} …` : "Checking the shared cache …"}</span>
        </span>
      )}

      {aiRec && (aiRec.status === "idle" || aiRec.status === "error") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {aiRec.alternates?.map((alt) => (
            <div key={`${alt.provider}:${alt.model}`} className="st-alt">
              <span style={{ flex: 1 }}>Already explained with <strong>{modelLabelFor(alt.provider, alt.model)}</strong></span>
              <button type="button" className="st-btn st-btn--sm" onClick={() => useAlternateAi(q, alt)}>Show it</button>
            </div>
          ))}
          {aiRec.status === "error" && <p className="st-error">{aiRec.error}</p>}
          {state.hasSessionKey ? (
            <>
              <p className="st-muted">No cached explanation for {providerLabel} · {modelLabel} yet.</p>
              <button type="button" className="st-btn st-btn--primary" onClick={() => genAi(q)}><Icon d={IC.sparkles} />Generate explanation</button>
            </>
          ) : state.keyMode === "encrypted" && state.hasStoredKey ? (
            <UnlockKeyPrompt onUnlock={() => genAi(q)} />
          ) : (
            <>
              <p className="st-muted">No key loaded — add one in Settings to generate a fresh explanation.</p>
              <button type="button" className="st-btn st-btn--primary" disabled><Icon d={IC.sparkles} />Generate explanation</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function visibleNotes(state: ReturnType<typeof usePrepDeck>["state"], qid: string) {
  return state.notes.filter((n) => n.qid === qid && (n.me || (n.vis === "shared" && state.showShared)));
}

export function NotesPanel({ qid }: { qid: string }) {
  const { state, setNoteDraft, addNote, setNoteVis } = usePrepDeck();
  const notes = visibleNotes(state, qid);
  return (
    <div className="st-panel">
      {notes.length > 0 && <div className="st-notes">{notes.map((n) => <NoteCard key={n.id} note={n} />)}</div>}
      <div className="st-compose">
        <textarea
          className="st-textarea" placeholder="Write a note for this question…" aria-label="Note for this question"
          value={state.noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
        />
        <div className="st-compose-row">
          <div className="st-segmented" role="group" aria-label="Note visibility">
            {(["private", "shared"] as const).map((v) => (
              <button key={v} type="button" className="st-seg-btn" aria-pressed={state.noteVis === v} onClick={() => setNoteVis(v)}>
                <Icon d={v === "private" ? IC.lock : IC.users} size={14} />{v === "private" ? "Private" : "Shared"}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="st-btn st-btn--primary" onClick={() => addNote(qid)}>Save note</button>
        </div>
      </div>
    </div>
  );
}

export function HistoryPanel({ rows, loading, answerRevisedAt, answerRevision }: { rows: LearningHistoryRow[]; loading: boolean; answerRevisedAt?: string | null; answerRevision?: number }) {
  if (loading) return <div className="st-panel"><span className="st-muted">Loading…</span></div>;
  if (!rows.length) {
    return (
      <div className="st-panel">
        <div className="st-empty">
          <span className="st-empty-icon"><Icon d={IC.history} size={20} /></span>
          <div className="st-empty-title">No attempts yet</div>
          <div className="st-empty-body">Not answered in Practice or Mock mode.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="st-panel st-panel--list">
      {rows.map((h, i) => (
        <div key={`${h.attemptId}-${i}`} className="st-history-row">
          <span className="st-badge">{h.mode === "mock" ? "Mock" : "Practice"}</span>
          <span className="st-history-text">Answered <strong style={{ fontWeight: 600 }}>{h.selectedAnswer.join(", ") || "—"}</strong></span>
          <span className={`st-badge ${h.isCorrect ? "st-badge--ok" : "st-badge--bad"}`}>
            <Icon d={h.isCorrect ? IC.circleCheck : IC.circleX} size={12} />{h.isCorrect ? "Correct" : "Incorrect"}
          </span>
          <span className="st-history-date">{new Date(h.answeredAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
          <AnswerRevisionNotice revisedAt={answerRevisedAt} historical={h.answerRevision == null || h.answerRevision < (answerRevision ?? 1)} gradedAnswers={h.gradedAnswers} />
        </div>
      ))}
    </div>
  );
}
