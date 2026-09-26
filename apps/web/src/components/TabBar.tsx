import { useLayoutEffect, useRef } from "react";
import { MORE_ICON_D, NAV } from "../data/constants";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { ScreenId } from "../types";

const TAB_IDS: ScreenId[] = ["dash", "practice", "mock", "wrong"];
const TAB_LABELS: Record<string, string> = {
  dash: "Home", practice: "Practice", mock: "Mock", wrong: "Wrong"
};
const MORE_IDS: ScreenId[] = ["learning", "bookmarks", "notes", "knowledgePoints", "settings"];

export default function TabBar({ onHeightChange }: { onHeightChange: (height: number) => void }) {
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => onHeightChange(nav.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav, { box: "border-box" });
    return () => observer.disconnect();
  }, [onHeightChange]);
  const { state, go, openMore } = usePrepDeck();

  return (
    <nav
      ref={navRef}
      aria-label="Main navigation"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, background: "var(--color-bg)",
        borderTop: "1px solid var(--color-divider)", padding: "8px 6px calc(8px + env(safe-area-inset-bottom))"
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2 }}>
        {TAB_IDS.map((id) => {
          const n = NAV.find((x) => x.id === id)!;
          const on = state.screen === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 2px",
                minHeight: 52, border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 10.5,
                borderRadius: 16, color: on ? "var(--color-accent-700)" : "var(--color-text-muted)"
              }}
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                <path d={n.d} />
              </svg>
              <span>{TAB_LABELS[id]}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={openMore}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 2px",
            minHeight: 52, border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 10.5,
            borderRadius: 16, color: state.more ? "var(--color-accent-700)" : "var(--color-text-muted)"
          }}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <path d={MORE_ICON_D} />
          </svg>
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}

export function MoreSheet() {
  const { state, go, closeMore } = usePrepDeck();
  if (!state.more) return null;
  // FR-13.1: the Admin entry is visible only to admin-role accounts.
  const moreIds = state.me?.role === "admin" ? [...MORE_IDS, "admin" as ScreenId] : MORE_IDS;
  return (
    <div onClick={closeMore} className="dialog-backdrop" style={{ alignItems: "flex-end", zIndex: 60 }}>
      <div className="dialog" style={{ width: "100%", maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <span className="dialog-title">More</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {moreIds.map((id) => {
            const n = NAV.find((x) => x.id === id)!;
            const on = state.screen === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: 0, borderRadius: 999,
                  background: on ? "var(--color-accent-200)" : "var(--color-neutral-100)",
                  color: on ? "var(--color-accent-800)" : "var(--color-text)",
                  cursor: "pointer", font: "inherit", fontSize: 15, textAlign: "left"
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d={n.d} />
                </svg>
                <span>{n.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
