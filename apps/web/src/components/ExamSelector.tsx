import { useEffect, useId, useRef, useState } from "react";
import { useWorkspaceActions, useWorkspaceState } from "../store/PrepDeckContext";

// Keyed by exam and URL below so an image failure cannot leak into another
// exam (or a replacement badge). Use the existing same-origin badge URL.
function ExamBadge({ src }: { src: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="exam-selector__badge" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" width="24" height="24" onError={() => setFailed(true)} />
      ) : (
        <svg className="exam-selector__badge-placeholder" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6.5A2.5 2.5 0 0 1 8.5 4H18v14H8.5A2.5 2.5 0 0 0 6 20.5z M6 6.5v14 M10 8h4 M10 12h4" />
        </svg>
      )}
    </span>
  );
}

export default function ExamSelector({ compact = false }: { compact?: boolean }) {
  const state = useWorkspaceState();
  const { setExamId } = useWorkspaceActions();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const activeExam = state.exams.find((exam) => exam.id === state.examId);
  const groupedExams = [...state.exams].sort((a, b) =>
    (a.providers[0]?.name ?? "Other").localeCompare(b.providers[0]?.name ?? "Other") || a.name.localeCompare(b.name)
  );

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        setOpen(false); rootRef.current?.querySelector<HTMLButtonElement>(".exam-selector__trigger")?.focus();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`exam-selector${compact ? " exam-selector--compact" : ""}`}>
      <button
        type="button"
        className="exam-selector__trigger"
        aria-label={compact
          ? `Select exam${activeExam ? `, current exam: ${activeExam.name}` : ""}`
          : activeExam ? `${activeExam.slug} — Select exam, current exam: ${activeExam.name}` : "Select an exam"}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        disabled={state.exams.length === 0 || state.switching}
        onClick={() => setOpen((value) => !value)}
      >
        <ExamBadge key={JSON.stringify([activeExam?.id, activeExam?.badgeIconUrl])} src={activeExam?.badgeIconUrl} />
        {!compact && <span className="exam-selector__name">{activeExam?.slug ?? "Select an exam"}</span>}
        <svg className="exam-selector__chevrons" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 5 3-3 3 3M10 9l-3 3-3-3" />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="exam-selector__menu" role="listbox" aria-label="Exams">
          <span className="exam-selector__label">Exams</span>
          {groupedExams.map((exam, index) => {
            const selected = exam.id === state.examId;
            const group = exam.providers.map((p) => p.shortName).join(" · ") || "Other";
            const previousGroup = index > 0 ? (groupedExams[index - 1]!.providers.map((p) => p.shortName).join(" · ") || "Other") : null;
            return (
              <div key={exam.id}>
              {group !== previousGroup && <span className="exam-selector__label">{group}</span>}
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`exam-selector__option${selected ? " exam-selector__option--selected" : ""}`}
                onClick={() => {
                  void setExamId(exam.id);
                  rootRef.current?.querySelector<HTMLButtonElement>(".exam-selector__trigger")?.focus();
                  setOpen(false);
                }}
              >
                <span className="exam-selector__check" aria-hidden="true">{selected ? "✓" : ""}</span>
                <span>{exam.name}</span>
              </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
