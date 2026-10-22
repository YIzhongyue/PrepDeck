// The interface languages PrepDeck offers (issue #191). Registering another
// one is an entry here plus its resource file in ./messages — see
// docs/guides/internationalization.md.

import type { MessageTree } from "./core";
import type { LocaleMessages } from "./messages/en";

export interface LocaleDefinition {
  /** BCP 47 tag: `<html lang>`, Intl formatting and the stored preference. */
  code: string;
  /** The language's name in itself, as the language menu lists it. */
  nativeName: string;
  /**
   * Lowercase browser language tags this locale answers for. A preference is
   * matched as written and then with trailing subtags removed, so "ja" also
   * takes "ja-JP".
   */
  matches: string[];
  /** Tags of the same language that must not fall back to this locale. */
  excludes?: string[];
  /** The resource file, loaded on demand so other languages cost nothing. */
  load: () => Promise<LocaleMessages | MessageTree>;
}

/** The source language and the fallback for every missing message. */
export const DEFAULT_LOCALE = "en";

export const LOCALES: readonly LocaleDefinition[] = [
  { code: "en", nativeName: "English", matches: ["en"], load: () => import("./messages/en").then((m) => m.default) },
  {
    code: "zh-CN",
    nativeName: "简体中文",
    // Simplified Chinese only. Traditional-script tags fall through to the
    // reader's next browser language (then English) rather than being shown
    // a script they did not ask for; they can still choose 简体中文 by hand.
    matches: ["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"],
    excludes: ["zh-tw", "zh-hk", "zh-mo", "zh-hant"],
    load: () => import("./messages/zh-CN").then((m) => m.default)
  },
  { code: "ja", nativeName: "日本語", matches: ["ja"], load: () => import("./messages/ja").then((m) => m.default) }
];

export type LocaleCode = string;

export function findLocale(code: string | null | undefined): LocaleDefinition | undefined {
  return code ? LOCALES.find((locale) => locale.code === code) : undefined;
}

/** Lowercase tag → locale code (or null for an excluded variant). */
export function localeMatchTable(locales: readonly LocaleDefinition[] = LOCALES): Map<string, string | null> {
  const table = new Map<string, string | null>();
  for (const locale of locales) {
    for (const tag of locale.excludes ?? []) table.set(tag, null);
  }
  for (const locale of locales) {
    for (const tag of [locale.code.toLowerCase(), ...locale.matches]) if (!table.has(tag)) table.set(tag, locale.code);
  }
  return table;
}
