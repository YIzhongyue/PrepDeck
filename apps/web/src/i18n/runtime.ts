// The active interface language without React (issue #191): `t()`, the
// locale-aware formatters and switching. Library and store code imports this
// module; components use the hook in ./index.tsx so they re-render on a switch.
//
// Switching language only notifies subscribers: it does not remount screens or
// touch the store, so a session in progress or an unsaved draft survives it. It
// never changes the account's time zone — formatters take the zone their caller
// already used.

import { Catalog, flattenMessages, formatNumberIn, negotiateLocale, type MessageTree, type MessageValues } from "./core";
import { DEFAULT_LOCALE, findLocale, localeMatchTable } from "./locales";
import en, { type TranslationKey } from "./messages/en";

export type { TranslationKey } from "./messages/en";
export type { MessageValues } from "./core";

export const LOCALE_STORAGE_KEY = "prepdeck.locale";

const english = flattenMessages(en as unknown as MessageTree);
const loaded = new Map<string, Map<string, string>>([[DEFAULT_LOCALE, english]]);

// The consistency test keeps shipped translations complete, so a gap is a bug
// worth one console line (per key and locale), not a broken screen.
const reported = new Set<string>();
function reportMissing(key: string, locale: string) {
  if (reported.has(`${locale}:${key}`)) return;
  reported.add(`${locale}:${key}`);
  console.warn(`[i18n] missing message "${key}" for ${locale}`);
}

function catalogFor(locale: string): Catalog {
  const chain = [{ locale, messages: loaded.get(locale) ?? english }];
  if (locale !== DEFAULT_LOCALE) chain.push({ locale: DEFAULT_LOCALE, messages: english });
  return new Catalog(locale, chain, reportMissing);
}

let catalog = catalogFor(DEFAULT_LOCALE);
const listeners = new Set<() => void>();

/** The active locale's BCP 47 tag. */
export function getLocale(): string {
  return catalog.locale;
}

/**
 * The active locale's message for `key`. A numeric `count` picks the plural
 * form. Components call it through `useI18n()` so they re-render on a switch;
 * code outside React (store actions, formatters) may call it directly.
 */
export function t(key: TranslationKey, values?: MessageValues): string {
  return catalog.format(key, values);
}

// ---------------------------------------------------------------------------
// Formatting. `undefined` used to mean "the browser's language"; it now means
// the interface language, so dates and numbers read like the text beside them.

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return formatNumberIn(catalog.locale, value, options);
}

export function formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(catalog.locale, options);
}

export function formatTime(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString(catalog.locale, options);
}

export function formatDateTime(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(catalog.locale, options);
}

/** "5 minutes ago", "yesterday" in the active language. */
export function formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(catalog.locale, { numeric: "auto" }).format(value, unit);
}

/** "a, b and c" in the active language. */
export function formatList(items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(catalog.locale, { style: "long", type }).format(items);
}

// ---------------------------------------------------------------------------
// Choosing the locale: a stored choice, then the browser's languages, then
// English. The choice is kept per browser, like the colour theme.

function readStoredLocale(): string | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return findLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeLocale(code: string): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // The choice still applies to this page when storage is unavailable.
  }
}

/** The locale a page opens in, before anything is loaded. */
export function initialLocale(): string {
  const stored = readStoredLocale();
  if (stored) return stored;
  const languages = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return negotiateLocale(languages.filter(Boolean), localeMatchTable()) ?? DEFAULT_LOCALE;
}

async function loadMessages(code: string): Promise<boolean> {
  if (loaded.has(code)) return true;
  const definition = findLocale(code);
  if (!definition) return false;
  try {
    loaded.set(code, flattenMessages((await definition.load()) as MessageTree));
    return true;
  } catch {
    return false;
  }
}

function activate(code: string) {
  catalog = catalogFor(code);
  if (typeof document !== "undefined") document.documentElement.lang = code;
  for (const listener of listeners) listener();
}

/**
 * Loads and applies the page's first locale. main.tsx awaits it before the
 * first render so a page never flashes English first; a resource that fails
 * to load leaves the page in English.
 */
export async function initI18n(): Promise<void> {
  const code = initialLocale();
  activate((await loadMessages(code)) ? code : DEFAULT_LOCALE);
}

/**
 * Switches the interface language and remembers it for this browser. Resolves
 * false, changing nothing, for an unknown locale or a resource that fails to
 * load.
 */
export async function setLocale(code: string): Promise<boolean> {
  if (!findLocale(code) || !(await loadMessages(code))) return false;
  storeLocale(code);
  if (code !== catalog.locale) activate(code);
  return true;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

