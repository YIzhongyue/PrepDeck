import type { ScreenId, ThemeOption } from "../types";

// Labels come from the `nav` messages (src/i18n/messages), keyed by these ids.
export interface NavItem {
  id: ScreenId;
  d: string;
}

export const NAV: NavItem[] = [
  { id: "dash", d: "M4 4h6v7H4z M14 4h6v4h-6z M4 15h6v5H4z M14 12h6v8h-6z" },
  { id: "learning", d: "M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" },
  { id: "practice", d: "M7 3h8l3 3v15H7z M10 11h6 M10 15h4" },
  { id: "mock", d: "M12 4a8 8 0 100 16 8 8 0 000-16z M12 8v4l3 2" },
  { id: "knowledgePoints", d: "M12 3l8 4.5-8 4.5-8-4.5z M4 12l8 4.5 8-4.5 M4 16.5l8 4.5 8-4.5" },
  { id: "bookmarks", d: "M7 4h10v16l-5-4-5 4z" },
  { id: "wrong", d: "M12 3l9 17H3z M12 9v5 M12 17h.01" },
  { id: "notes", d: "M4 19l10-10 3 3-10 10H4z M14 6l2-2 3 3-2 2" },
  { id: "settings", d: "M12 9a3 3 0 100 6 3 3 0 000-6z M12 2v3 M12 19v3 M4 12H1 M23 12h-3 M6 6L4 4 M20 20l-2-2 M6 18l-2 2 M20 4l-2 2" },
  // docs/requirements/question-bank-management.md — visible only to admin-role accounts (filtered in Sidebar/TabBar).
  { id: "admin", d: "M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" }
];

// The sidebar's sections. The page breadcrumb names a screen by its section,
// so the two read the same way.
export type NavGroupId = "overview" | "study" | "resources" | "system";
export const NAV_GROUPS: { id: NavGroupId; ids: ScreenId[] }[] = [
  { id: "overview", ids: ["dash"] },
  { id: "study", ids: ["learning", "practice", "mock"] },
  { id: "resources", ids: ["knowledgePoints", "bookmarks", "wrong", "notes"] },
  { id: "system", ids: ["settings", "admin"] }
];

export const MORE_ICON_D = "M5 12h.01 M12 12h.01 M19 12h.01";

export const THEMES: ThemeOption[] = [
  { id: "light", bg: "#ffffff", accent: "#2563eb", accent2: "#0f9f8f", line: "#dbe3ef", surface: "#f5f7fb", ink: "#172033" },
  { id: "cream", bg: "#f5ead8", accent: "#c67139", accent2: "#7a8a5e", line: "#dcd3c4", surface: "#fbf5ea", ink: "#3a2a1c" },
  { id: "sage", bg: "#f2f1e3", accent: "#7a8a5e", accent2: "#c67139", line: "#ccdbb2", surface: "#f9f8ee", ink: "#2d3322" },
  { id: "clay", bg: "#f6e3d2", accent: "#b2622d", accent2: "#7a8a5e", line: "#ddc7ae", surface: "#fbf0e5", ink: "#3b2415" },
  { id: "dusk", bg: "#2a2721", accent: "#e0894f", accent2: "#a3b788", line: "#645c50", surface: "#35312a", ink: "#efe6d8" }
];

export const HL: Record<string, { background: string; text: string }> = {
  hl1: { background: "var(--color-mark-1)", text: "var(--color-mark-1-text)" },
  hl2: { background: "var(--color-mark-2)", text: "var(--color-mark-2-text)" },
  hl3: { background: "var(--color-mark-3)", text: "var(--color-mark-3-text)" }
};

export const SHOW_KEYBOARD_HINTS = true;
