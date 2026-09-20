import { useState, type CSSProperties } from "react";
import type { TextSegment } from "../types";

export default function HighlightedText({ segs, onRemoveMark }: { segs: TextSegment[]; onRemoveMark?: (id: string) => void }) {
  const [hoveredMarks, setHoveredMarks] = useState<string[]>([]);

  return (
    <>
      {segs.map((s) => {
        const style: CSSProperties = {
          background: s.code ? "var(--color-neutral-200)" : s.bg,
          color: s.code ? "inherit" : s.color,
          padding: s.code ? "1px 5px" : s.pad,
          borderRadius: s.code ? "5px" : s.br,
          fontWeight: s.weight as CSSProperties["fontWeight"],
          fontStyle: s.italic ? "italic" : "normal",
          fontFamily: s.code ? "var(--font-mono, ui-monospace, monospace)" : undefined,
          fontSize: s.code ? "0.92em" : undefined,
          textDecorationLine: s.deco,
          textDecorationColor: "var(--color-accent-600)",
          textDecorationThickness: "2px",
          textUnderlineOffset: "3px"
        };
        const annotationIds = s.annotationIds ?? [];
        return (
          <span
            key={s.key} data-off={s.off} title={s.title} style={style}
            onMouseEnter={() => setHoveredMarks(annotationIds)}
            onMouseLeave={() => setHoveredMarks([])}
          >
            {s.text}
            {onRemoveMark && s.endingAnnotationIds?.map((id) => {
              const visible = hoveredMarks.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-label="Delete mark"
                  title="Delete mark"
                  onMouseEnter={() => setHoveredMarks([id])}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onMouseUp={(e) => e.stopPropagation()}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveMark(id); }}
                  style={{
                    display: "inline-grid", placeItems: "center", width: 18, height: 18,
                    marginLeft: 4, padding: 0, border: "1px solid var(--color-divider)", borderRadius: 999,
                    background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer",
                    verticalAlign: "0.08em", opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none",
                    transform: visible ? "scale(1)" : "scale(.8)", transition: "opacity .12s ease, transform .12s ease",
                    boxShadow: "0 1px 4px color-mix(in srgb, var(--color-text) 18%, transparent)"
                  }}
                >
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M3 3l6 6M9 3L3 9" />
                  </svg>
                </button>
              );
            })}
          </span>
        );
      })}
    </>
  );
}
