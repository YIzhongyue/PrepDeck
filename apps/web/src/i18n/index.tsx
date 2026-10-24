// React side of the interface language (issue #191). See ./runtime.ts for
// `t()`, formatting and switching, and docs/guides/internationalization.md.

import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { I18nProvider as AriaI18nProvider } from "react-aria-components";
import { LOCALES } from "./locales";
import { formatDate, formatDateTime, formatList, formatNumber, formatRelative, formatTime, getLocale, setLocale, subscribe, t, type TranslationKey } from "./runtime";

export * from "./runtime";
export { LOCALES, DEFAULT_LOCALE } from "./locales";

// ---------------------------------------------------------------------------
// Rich text: a message may wrap words in tags (`<link>Settings</link>`) that
// a caller turns into elements, keeping word order in the translator's hands.

type RichValue = ReactNode | ((chunks: ReactNode) => ReactNode);

export function formatRich(key: TranslationKey, values: Record<string, RichValue | string | number> = {}): ReactNode {
  // Only the count goes through t(), to pick the plural form. Every other
  // value is inserted by renderRich as a text node, so a value that looks like
  // a tag (an exam named "<b>") can never be parsed as one.
  const template = typeof values.count === "number" ? t(key, { count: values.count }) : t(key);
  return renderRich(template, values);
}

/** Exported for tests: splits `<tag>…</tag>` and `{name}` against `values`. */
export function renderRich(template: string, values: Record<string, RichValue | string | number>): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /<(\w+)>(.*?)<\/\1>|\{(\w+)\}/gs;
  let last = 0;
  let index = 0;
  for (const match of template.matchAll(pattern)) {
    if (match.index > last) parts.push(template.slice(last, match.index));
    const [whole, tag, inner, name] = match;
    const value = values[tag ?? name!];
    if (tag) parts.push(<Fragment key={index++}>{typeof value === "function" ? value(renderRich(inner!, values)) : renderRich(inner!, values)}</Fragment>);
    else if (value === undefined || typeof value === "function") parts.push(whole);
    else parts.push(<Fragment key={index++}>{typeof value === "number" ? formatNumber(value) : value}</Fragment>);
    last = match.index + whole.length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts;
}

/**
 * The active locale and its helpers. A component that renders text calls this
 * (rather than importing `t` alone) so it re-renders when the language changes.
 */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, t, rich: formatRich, formatNumber, formatDate, formatTime, formatDateTime, formatRelative, formatList, setLocale, locales: LOCALES };
}

/**
 * Hands the active locale to React Aria, whose own controls (date fields,
 * combo boxes) then label and format themselves in the same language.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return <AriaI18nProvider locale={locale}>{children}</AriaI18nProvider>;
}
