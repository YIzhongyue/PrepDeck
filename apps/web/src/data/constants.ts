import type { ThemeOption } from "../types";

export interface NavItem {
  id: string;
  label: string;
  d: string;
}

export const NAV: NavItem[] = [
  { id: "dash", label: "Statistics", d: "M4 4h6v7H4z M14 4h6v4h-6z M4 15h6v5H4z M14 12h6v8h-6z" },
  { id: "learning", label: "Learning", d: "M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" },
  { id: "practice", label: "Practice", d: "M7 3h8l3 3v15H7z M10 11h6 M10 15h4" },
  { id: "mock", label: "Mock exam", d: "M12 4a8 8 0 100 16 8 8 0 000-16z M12 8v4l3 2" },
  { id: "knowledgePoints", label: "Knowledge points", d: "M12 3l8 4.5-8 4.5-8-4.5z M4 12l8 4.5 8-4.5 M4 16.5l8 4.5 8-4.5" },
  { id: "bookmarks", label: "Bookmarks", d: "M7 4h10v16l-5-4-5 4z" },
  { id: "wrong", label: "Wrong questions", d: "M12 3l9 17H3z M12 9v5 M12 17h.01" },
  { id: "notes", label: "Annotations", d: "M4 19l10-10 3 3-10 10H4z M14 6l2-2 3 3-2 2" },
  { id: "settings", label: "Settings", d: "M12 9a3 3 0 100 6 3 3 0 000-6z M12 2v3 M12 19v3 M4 12H1 M23 12h-3 M6 6L4 4 M20 20l-2-2 M6 18l-2 2 M20 4l-2 2" },
  // docs/requirements/question-bank-management.md — visible only to admin-role accounts (filtered in Sidebar/TabBar).
  { id: "admin", label: "Admin", d: "M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" }
];

export const MORE_ICON_D = "M5 12h.01 M12 12h.01 M19 12h.01";

export const THEMES: ThemeOption[] = [
  { id: "light", name: "Light", hint: "default", bg: "#ffffff", accent: "#2563eb", accent2: "#0f9f8f", line: "#dbe3ef" },
  { id: "cream", name: "Cream", hint: "soft", bg: "#f5ead8", accent: "#c67139", accent2: "#7a8a5e", line: "#dcd3c4" },
  { id: "sage", name: "Sage", hint: "calm", bg: "#f2f1e3", accent: "#7a8a5e", accent2: "#c67139", line: "#ccdbb2" },
  { id: "clay", name: "Clay", hint: "warm", bg: "#f6e3d2", accent: "#b2622d", accent2: "#7a8a5e", line: "#ddc7ae" },
  { id: "dusk", name: "Dusk", hint: "low light", bg: "#2a2721", accent: "#e0894f", accent2: "#a3b788", line: "#645c50" }
];

export const HL: Record<string, { background: string; text: string }> = {
  hl1: { background: "var(--color-mark-1)", text: "var(--color-mark-1-text)" },
  hl2: { background: "var(--color-mark-2)", text: "var(--color-mark-2-text)" },
  hl3: { background: "var(--color-mark-3)", text: "var(--color-mark-3-text)" }
};

export const SHOW_KEYBOARD_HINTS = true;
