import type { KeyMode } from "../types";

// Per account, like the encrypted key it describes (issue #46).
export const KEY_MODE_STORAGE_KEY = "prepdeck.keyMode";
const keyFor = (userId: string) => `${KEY_MODE_STORAGE_KEY}:${userId}`;

const KEY_MODES: readonly KeyMode[] = ["memory", "encrypted"];

export function getStoredKeyMode(userId: string): KeyMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(keyFor(userId));
    return KEY_MODES.includes(value as KeyMode) ? (value as KeyMode) : null;
  } catch {
    return null;
  }
}

// The browser-wide value from before is nobody's in particular; it is removed on
// sign-out rather than attributed to whoever signs in next.
export function clearLegacyKeyMode(): void {
  try {
    window.localStorage.removeItem(KEY_MODE_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function storeKeyMode(userId: string, mode: KeyMode): void {
  try {
    window.localStorage.setItem(keyFor(userId), mode);
  } catch {
    // The selected mode still applies for this session when storage is unavailable.
  }
}
