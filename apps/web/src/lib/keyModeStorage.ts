import type { KeyMode } from "../types";

export const KEY_MODE_STORAGE_KEY = "prepdeck.keyMode";

const KEY_MODES: readonly KeyMode[] = ["memory", "encrypted"];

export function getStoredKeyMode(): KeyMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(KEY_MODE_STORAGE_KEY);
    return KEY_MODES.includes(value as KeyMode) ? (value as KeyMode) : null;
  } catch {
    return null;
  }
}

export function storeKeyMode(mode: KeyMode): void {
  try {
    window.localStorage.setItem(KEY_MODE_STORAGE_KEY, mode);
  } catch {
    // The selected mode still applies for this session when storage is unavailable.
  }
}
