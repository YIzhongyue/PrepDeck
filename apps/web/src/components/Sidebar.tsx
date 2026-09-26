import { reviewIds } from "../lib/reviewLists";
import { NAV } from "../data/constants";
import { usePrepDeck } from "../store/PrepDeckContext";
import BrandLogo from "./BrandLogo";
import ExamSelector from "./ExamSelector";
import ProfileAvatar from "./ProfileAvatar";

const NAV_GROUPS = [
  { label: "Overview", ids: ["dash"] },
  { label: "Study", ids: ["learning", "practice", "mock"] },
  { label: "Resources", ids: ["knowledgePoints", "bookmarks", "wrong", "notes"] },
  { label: "System", ids: ["settings", "admin"] }
];

export default function Sidebar({ rail }: { rail: boolean }) {
  const { state, go } = usePrepDeck();
  const wrongCount = reviewIds(state, "wrong").length;
  const bmCount = reviewIds(state, "bm").length;
  // FR-13.1: the Admin nav entry is visible only to admin-role accounts.
  const items = NAV.filter((item) => item.id !== "admin" || state.me?.role === "admin");

  return (
    <aside
      style={{
        width: rail ? 236 : 68, flex: "none", display: "flex", flexDirection: "column",
        gap: 4, padding: "22px 14px 18px", position: "sticky", top: 0, height: "100vh",
        borderRight: "1px solid var(--color-divider)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "0 3px 18px", minHeight: 48 }}>
        <BrandLogo compact={!rail} />
      </div>

      <ExamSelector compact={!rail} />

      <nav aria-label="Main navigation" style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 0" }}>
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => group.ids.includes(item.id));
          if (groupItems.length === 0) return null;
          return (
            <div key={group.label} role="group" aria-label={group.label} style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, marginTop: group.label === "System" ? "auto" : undefined }}>
              {rail && groupItems.length > 1 && (
                <div aria-hidden="true" style={{ padding: "0 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--color-text-muted)" }}>
                  {group.label}
                </div>
              )}
              {groupItems.map((item) => {
                const on = state.screen === item.id;
                const badge = item.id === "wrong" ? String(wrongCount) : item.id === "bookmarks" ? String(bmCount) : "";
                const showBadge = badge && badge !== "0" && rail;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id as typeof state.screen)}
                    title={item.label}
                    style={{
                      display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 10px",
                      border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 14, textAlign: "left",
                      background: on ? "var(--color-accent-200)" : "transparent", color: on ? "var(--color-accent-800)" : "var(--color-text)"
                    }}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", opacity: 0.9 }}>
                      <path d={item.d} />
                    </svg>
                    <span style={{ display: rail ? "inline" : "none", whiteSpace: "nowrap" }}>{item.label}</span>
                    {showBadge && (
                      <span style={{ marginLeft: "auto", display: "inline-block", fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "var(--color-accent-200)", color: "var(--color-accent-800)" }}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "10px 8px 0", borderTop: "1px solid var(--color-divider)" }}>
        <ProfileAvatar profile={state.me} />
        <span style={{ display: rail ? "inline" : "none", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {state.me?.displayName || state.me?.email || "Loading…"}
          </span>
          <span style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", textTransform: "capitalize" }}>
            {state.me?.role || ""}
          </span>
        </span>
      </div>
    </aside>
  );
}
