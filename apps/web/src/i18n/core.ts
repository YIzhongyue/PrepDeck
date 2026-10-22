// The framework-free part of PrepDeck's interface translations (issue #191):
// message lookup with an English fallback, `{name}` interpolation, plural
// selection and locale negotiation. React wiring lives in ./index.tsx; this
// file has no DOM or React dependency so Node tests can load it directly.
//
// docs/guides/internationalization.md describes the message format and how to
// add a locale.

/** A resource tree: nested namespaces whose leaves are message templates. */
export interface MessageTree {
  [key: string]: string | MessageTree;
}

/** Plural categories a message can carry as a `_<category>` key suffix. */
export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export type MessageValues = Record<string, string | number | null | undefined>;

/** Every message in a tree, keyed by its dotted path ("settings.title"). */
export function flattenMessages(tree: MessageTree, prefix = "", into = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") into.set(path, value);
    else flattenMessages(value, path, into);
  }
  return into;
}

/** The plural base of a key ("admin.count_one" → "admin.count"), or null. */
export function pluralBase(key: string): { base: string; category: PluralCategory } | null {
  const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return match ? { base: match[1]!, category: match[2] as PluralCategory } : null;
}

/** The `{name}` placeholders a template refers to, sorted. */
export function placeholders(template: string): string[] {
  return [...new Set(Array.from(template.matchAll(/\{(\w+)\}/g), (m) => m[1]!))].sort();
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, count: number): PluralCategory {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) as PluralCategory;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
export function formatNumberIn(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  if (options) return new Intl.NumberFormat(locale, options).format(value);
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

/**
 * Fills a template's `{name}` placeholders. Numbers are formatted for the
 * locale; a placeholder without a value is left as written so a missing
 * argument shows up rather than vanishing.
 */
export function interpolate(template: string, locale: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) return whole;
    return typeof value === "number" ? formatNumberIn(locale, value) : value;
  });
}

/**
 * One locale's messages with the fallback chain behind it. A lookup tries the
 * active locale, then each fallback (English last), so a message a
 * translation does not have yet still reads as English instead of as its key.
 */
export class Catalog {
  constructor(
    readonly locale: string,
    private readonly chain: { locale: string; messages: Map<string, string> }[],
    private readonly onMissing: (key: string, locale: string) => void = () => {}
  ) {}

  /** The template and the locale it came from, for a plain or plural key. */
  private resolve(key: string, count: number | undefined): { template: string; locale: string } | null {
    for (const { locale, messages } of this.chain) {
      if (count !== undefined) {
        const plural = messages.get(`${key}_${pluralCategory(locale, count)}`) ?? messages.get(`${key}_other`);
        if (plural !== undefined) return { template: plural, locale };
      }
      const plain = messages.get(key);
      if (plain !== undefined) return { template: plain, locale };
      if (locale === this.locale && this.chain.length > 1) this.onMissing(key, locale);
    }
    return null;
  }

  /**
   * The message for `key` in this locale. A numeric `count` value selects the
   * plural form (`key_one`, `key_other`, …) by the locale's plural rules.
   */
  format(key: string, values?: MessageValues): string {
    const count = typeof values?.count === "number" ? values.count : undefined;
    const found = this.resolve(key, count);
    if (!found) {
      this.onMissing(key, "*");
      // Never a dotted key on screen: the last segment reads as a word at worst.
      return key.slice(key.lastIndexOf(".") + 1);
    }
    return interpolate(found.template, found.locale, values);
  }
}

/**
 * Picks the supported locale for a list of preferred language tags, such as
 * `navigator.languages`. Each preference is tried as written and then with
 * its trailing subtags removed ("zh-Hans-CN", "zh-Hans", "zh"), first match
 * wins. `table` maps lowercase tags to a supported locale, or to null for a
 * variant that must not fall back to its language (Traditional Chinese must
 * not land on the Simplified translation).
 */
export function negotiateLocale(preferences: readonly string[], table: ReadonlyMap<string, string | null>): string | null {
  for (const preference of preferences) {
    const subtags = preference.trim().replace(/_/g, "-").toLowerCase().split("-").filter(Boolean);
    for (let length = subtags.length; length > 0; length--) {
      const tag = subtags.slice(0, length).join("-");
      if (!table.has(tag)) continue;
      const locale = table.get(tag);
      if (locale) return locale;
      break; // a blocked variant: try the next preference
    }
  }
  return null;
}
