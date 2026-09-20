import type { ThemeId } from "../types";

export const DEFAULT_THEME: ThemeId = "light";
export const THEME_STORAGE_KEY = "prepdeck.theme";

const THEME_IDS: readonly ThemeId[] = ["light", "cream", "sage", "clay", "dusk"];

export function getStoredTheme(): ThemeId | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_IDS.includes(value as ThemeId) ? value as ThemeId : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}
