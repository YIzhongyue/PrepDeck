// Issue #191: interface translations. Every registered locale must carry
// exactly the English keys (plural messages in its own plural categories),
// the same placeholders and rich-text tags; lookups fall back to English;
// interpolation, plurals and locale negotiation behave; and switching the
// active language re-renders through its subscribers without losing state.
import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

const src = (path) => new URL(`../src/i18n/${path}`, import.meta.url);
const core = await importTs(src("core.ts"));
const { LOCALES, DEFAULT_LOCALE, localeMatchTable } = await importTs(src("locales.ts"));
const { default: en } = await importTs(src("messages/en.ts"));

const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;
const tagsOf = (template) => [...new Set(Array.from(template.matchAll(/<(\w+)>/g), (m) => m[1]))].sort();

// base key → { plural: boolean, placeholders, tags } for the English source.
function describe(messages) {
  const entries = new Map();
  for (const [key, template] of core.flattenMessages(messages)) {
    const plural = PLURAL.exec(key);
    const base = plural ? plural[1] : key;
    const entry = entries.get(base) ?? { plural: !!plural, categories: new Set(), placeholders: new Set(), tags: new Set() };
    if (plural) entry.categories.add(plural[2]);
    for (const name of core.placeholders(template)) entry.placeholders.add(name);
    for (const tag of tagsOf(template)) entry.tags.add(tag);
    entries.set(base, entry);
  }
  return entries;
}

const english = describe(en);
const loadLocale = async (code) => LOCALES.find((l) => l.code === code).load();

test("English is the default locale and the fallback, and every message key is unique", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(LOCALES[0].code, "en");
  assert.equal(new Set(LOCALES.map((l) => l.code)).size, LOCALES.length);
  assert.ok(english.size > 1000, "the interface strings live in the resources");
  for (const [base, entry] of english) {
    if (entry.plural) assert.ok(entry.categories.has("other"), `${base} has an "other" form`);
  }
});

for (const { code } of LOCALES.filter((l) => l.code !== DEFAULT_LOCALE)) {
  test(`${code}: same keys, plural forms, placeholders and tags as English`, async () => {
    const messages = await loadLocale(code);
    const required = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    const translated = describe(messages);
    const problems = [];
    for (const [base, entry] of translated) {
      const source = english.get(base);
      if (!source) { problems.push(`unknown key ${base}`); continue; }
      if (source.plural !== entry.plural) problems.push(`${base}: plural in one language only`);
      const extra = [...entry.placeholders].filter((name) => !source.placeholders.has(name));
      // A plural form may leave the count out ("one day"); nothing else may go.
      const missing = [...source.placeholders].filter((name) => !entry.placeholders.has(name) && !(entry.plural && name === "count"));
      if (extra.length || missing.length) problems.push(`${base}: placeholders +${extra} -${missing}`);
      if ([...entry.tags].sort().join() !== [...source.tags].sort().join()) problems.push(`${base}: rich-text tags differ`);
      if (entry.plural) {
        for (const category of required) if (!entry.categories.has(category)) problems.push(`${base}: missing ${category} form`);
        for (const category of entry.categories) if (!required.includes(category)) problems.push(`${base}: ${category} is not a ${code} plural category`);
      }
    }
    for (const base of english.keys()) if (!translated.has(base)) problems.push(`missing ${base}`);
    for (const [key, template] of core.flattenMessages(messages)) {
      if (!template.trim()) problems.push(`${key} is empty`);
    }
    assert.deepEqual(problems, []);
  });
}

test("interpolation fills values, formats numbers for the locale, and leaves a missing value visible", () => {
  assert.equal(core.interpolate("Step {step} of {total}", "en", { step: 1, total: 2 }), "Step 1 of 2");
  assert.equal(core.interpolate("{count} answers", "en", { count: 12345 }), "12,345 answers");
  assert.equal(core.interpolate("{count} answers", "de", { count: 12345 }), "12.345 answers");
  assert.equal(core.interpolate("Hello {name}", "en", {}), "Hello {name}");
  assert.equal(core.interpolate("ID {id}", "en", { id: "0042" }), "ID 0042", "strings are not reformatted");
  assert.deepEqual(core.placeholders("{a} and {b} and {a}"), ["a", "b"]);
});

test("plural messages pick the locale's category, and a language without plurals uses other", () => {
  const messages = new Map([["x.days_one", "{count} day"], ["x.days_other", "{count} days"]]);
  const english = new core.Catalog("en", [{ locale: "en", messages }]);
  assert.equal(english.format("x.days", { count: 1 }), "1 day");
  assert.equal(english.format("x.days", { count: 2 }), "2 days");
  assert.equal(english.format("x.days", { count: 0 }), "0 days");
  const japanese = new core.Catalog("ja", [{ locale: "ja", messages: new Map([["x.days_other", "{count} 日"]]) }, { locale: "en", messages }]);
  assert.equal(japanese.format("x.days", { count: 1 }), "1 日");
});

test("a message missing from a translation falls back to English, never to its key", () => {
  const missing = [];
  const catalog = new core.Catalog("ja", [
    { locale: "ja", messages: new Map([["a.translated", "翻訳済み"]]) },
    { locale: "en", messages: new Map([["a.translated", "Translated"], ["a.onlyEnglish", "Only {what}"]]) },
  ], (key, locale) => missing.push(`${locale}:${key}`));
  assert.equal(catalog.format("a.translated"), "翻訳済み");
  assert.equal(catalog.format("a.onlyEnglish", { what: "English" }), "Only English");
  assert.deepEqual(missing, ["ja:a.onlyEnglish"], "the gap is reported");
  // Not a dotted key, even for a key no language has.
  assert.equal(catalog.format("a.nowhere.toBeFound"), "toBeFound");
});

test("browser languages are matched by tag, then by language, and Traditional Chinese is not sent to Simplified", () => {
  const table = localeMatchTable();
  const pick = (...preferences) => core.negotiateLocale(preferences, table);
  assert.equal(pick("ja-JP"), "ja");
  assert.equal(pick("zh-CN"), "zh-CN");
  assert.equal(pick("zh"), "zh-CN");
  assert.equal(pick("zh-Hans-SG"), "zh-CN");
  assert.equal(pick("zh_CN"), "zh-CN", "underscores are accepted");
  assert.equal(pick("en-GB"), "en");
  assert.equal(pick("fr-FR"), null, "an unsupported language matches nothing");
  assert.equal(pick("zh-TW"), null);
  assert.equal(pick("zh-Hant-HK", "ja"), "ja", "a blocked variant moves on to the next preference");
  assert.equal(pick("fr", "zh-TW", "en-US"), "en");
  assert.equal(pick(), null);
});

test("the runtime switches language, notifies subscribers, persists the choice and refuses unknown locales", async () => {
  const stored = new Map();
  globalThis.window = { localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)) } };
  // Node has its own read-only navigator; stand in a browser's for the test.
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { languages: ["fr-FR", "ja-JP"], language: "fr-FR" }, configurable: true });
  try {
    const runtime = await importTs(src("runtime.ts"));
    assert.equal(runtime.getLocale(), "en");
    assert.equal(runtime.t("nav.screens.settings"), "Settings");
    assert.equal(runtime.initialLocale(), "ja", "the first supported browser language wins");

    let notified = 0;
    const unsubscribe = runtime.subscribe(() => { notified++; });
    assert.equal(await runtime.setLocale("ja"), true);
    assert.equal(runtime.getLocale(), "ja");
    assert.equal(runtime.t("nav.screens.settings"), "設定");
    assert.equal(runtime.t("setup.questions", { count: 1 }), "1 問");
    assert.equal(runtime.formatNumber(1234.5), "1,234.5");
    assert.equal(notified, 1);
    assert.equal(stored.get(runtime.LOCALE_STORAGE_KEY), "ja");
    assert.equal(runtime.initialLocale(), "ja", "a stored choice beats the browser's languages");

    assert.equal(await runtime.setLocale("xx-YY"), false);
    assert.equal(runtime.getLocale(), "ja", "an unknown locale changes nothing");
    stored.set(runtime.LOCALE_STORAGE_KEY, "xx-YY");
    assert.equal(runtime.initialLocale(), "ja", "a stored value that is not a locale is ignored");

    assert.equal(await runtime.setLocale("zh-CN"), true);
    assert.equal(runtime.t("nav.screens.settings"), "设置");
    assert.equal(runtime.t("mock.submit.answered", { answered: 3, count: 10 }), "你已作答 3 / 10 道题。");
    assert.equal(await runtime.setLocale("en"), true);
    assert.equal(runtime.t("mock.submit.answered", { answered: 1, count: 1 }), "You have answered 1 of 1 question.");
    assert.equal(notified, 3);
    unsubscribe();
  } finally {
    delete globalThis.window;
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete globalThis.navigator;
  }
});

test("rich messages split tags and placeholders into elements without reordering the words", async () => {
  const { renderRich } = await importTs(src("index.tsx"), { platform: "browser" });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const html = (template, values) => renderToStaticMarkup(createElement("p", null, renderRich(template, values)));
  assert.equal(html("Here's how your <exam>{name}</exam> prep is tracking.", { exam: (c) => createElement("strong", null, c), name: "Cloud <Pro>" }),
    "<p>Here&#x27;s how your <strong>Cloud &lt;Pro&gt;</strong> prep is tracking.</p>", "values are text, never markup");
  assert.equal(html("<link>設定</link>で変更", { link: (c) => createElement("a", { href: "#" }, c) }), "<p><a href=\"#\">設定</a>で変更</p>");
  assert.equal(html("{count} left", { count: 1200 }), "<p>1,200 left</p>");
  assert.equal(html("Plain text", {}), "<p>Plain text</p>");
});

test("a rich message never parses a value as markup", async () => {
  const { formatRich, setLocale } = await importTs(src("index.tsx"), { platform: "browser" });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  await setLocale("en");
  const markup = renderToStaticMarkup(createElement("p", null,
    formatRich("stats.header.tracking", { exam: (c) => createElement("strong", null, c), name: "<exam>Injected</exam> {name}" })));
  assert.equal(markup, "<p>Here&#x27;s how your <strong>&lt;exam&gt;Injected&lt;/exam&gt; {name}</strong> prep is tracking today.</p>");
});
