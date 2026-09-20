import { useEffect, useId, useRef, useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";

export default function ExamSelector({ compact = false }: { compact?: boolean }) {
  const { state, setExamId } = usePrepDeck();
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
        aria-label={`Select exam${activeExam ? `, current exam: ${activeExam.name}` : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        disabled={state.exams.length === 0 || state.switching}
        onClick={() => setOpen((value) => !value)}
      >
        {compact ? (
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z M4 5.5v16 M8 7h8" />
          </svg>
        ) : (
          <span className="exam-selector__name">{activeExam?.slug ?? "Select an exam"}</span>
        )}
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
