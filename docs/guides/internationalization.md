# Interface languages

PrepDeck's web interface is available in **English**, **Simplified Chinese**
and **Japanese** (issue #191). Every menu, button, label, status, dialog,
validation and error message the web app itself writes, and every accessible
name, comes from shared translation resources with stable message keys.
Screens are not duplicated per language and features contain no per-language
branches.

This guide records the decisions behind it, what is and is not translated,
how to write translatable UI code, and how to add another language.

## Decisions

| Question | Decision |
| --- | --- |
| Languages | `en` (English), `zh-CN` (Simplified Chinese), `ja` (Japanese), as BCP 47 tags. English is the source language. |
| Chinese variant | Simplified Chinese only. Browser tags `zh`, `zh-CN`, `zh-SG`, `zh-MY` and `zh-Hans-*` select it. Traditional tags (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant-*`) do not: the reader's next browser language applies, then English. Anyone can still choose 简体中文 by hand. |
| First language | A choice saved in this browser, else the first supported language in the browser's preference list (`navigator.languages`), else English. |
| Changing it | **Settings → Study → Language**, and a compact picker on the sign-in, MCP connection and legal pages for visitors who are not signed in. Languages are listed by their own names (日本語, 简体中文). |
| Persistence | Per browser, in `localStorage` under `prepdeck.locale`, like the colour theme. It is not an account setting, so it needs no API or migration and applies before sign-in. |
| Fallback | A message missing from a translation shows the English text. A locale that is unknown or fails to load leaves the page in English. Raw message keys are never shown. |
| Side effects | Switching language only re-renders. It never remounts screens or touches the store, so a practice or mock session in progress and any unsaved draft survive it. It never changes the account's time zone, scoring, stored data or API identifiers. |

## What is and is not translated

Translated:

- navigation, page titles (including the browser tab title), Settings,
  Statistics, Learning, Practice, mock exams and results, review lists,
  annotations, Knowledge Points and the Markdown editor, the admin console,
  question authoring and import, MCP token management and the MCP connection
  (consent) screen, sign-in and session-expiry dialogs;
- dialogs, confirmations, validation, empty and loading states, and the error
  messages the web app writes itself;
- accessible names (`aria-label`s, alt text, live-region announcements);
- dates, times, relative times, numbers and lists, which use the interface
  language's formatting (`Intl`), in the account's time zone as before;
- React Aria's own controls (date picker, combo boxes), which receive the
  interface language through `I18nProvider`;
- Cloudflare Turnstile's widget, which is asked for the same language.

Deliberately not translated (deferred):

- **Content**: questions, options, explanations, exam and provider names,
  tags, Knowledge Points, notes, AI explanations and imported material stay as
  written. So do the default mark aliases, which are the user's own data.
- **Server-written messages**: an error text returned by the API (for example a
  4xx `error` field) and shared validation messages from `@prepdeck/shared`
  (import and question validation issues) are shown as the server wrote them,
  in English. Moving them to error codes is follow-up work.
- **Emails**: the daily review email and other notification emails.
- **MCP-facing prose**: tool descriptions, the MCP setup prompt and the
  "Copy as prompt" Markdown, which are read by AI clients.
- **Legal documents**: the Privacy Policy and Terms of Service stay English (the
  English text is the one that applies). In another language a note says so,
  and the document body is marked `lang="en"` for assistive technology.
- Text that is data: the placeholder an AI-targeted annotation indexes into
  (`Notes.tsx`) must stay byte-identical, so it is not translated.

## How it works

The code is in `apps/web/src/i18n/`:

| File | Role |
| --- | --- |
| `core.ts` | Framework-free: flattening resources, `{name}` interpolation, plural selection (`Intl.PluralRules`), the English fallback chain (`Catalog`) and browser-language negotiation. |
| `locales.ts` | The registry: each locale's code, native name, the browser tags it answers for, and a lazy loader for its resource file. |
| `runtime.ts` | The active locale: `t()`, `formatNumber/Date/Time/DateTime/Relative/List`, `setLocale`, `initI18n`, and change subscription. No React. Store actions and library modules import this. |
| `index.tsx` | React: `useI18n()`, `I18nProvider` (also React Aria's), and rich text (`rich()`). |
| `messages/en.ts` | English messages — the source of truth, and the type every key is checked against. |
| `messages/zh-CN.ts`, `messages/ja.ts` | Translations. |

`main.tsx` awaits `initI18n()` before the first render, so a page never flashes
English first. Non-English resources are separate chunks loaded on demand;
English is part of the main bundle because it is the fallback.

## Writing translatable UI

- In a component, call `const { t } = useI18n();` and use `t("namespace.key")`.
  The hook subscribes the component, so it re-renders when the language
  changes. Calling the imported `t` without the hook works but would leave the
  component on the old language until something else re-renders it.
- Outside React (store actions, `lib/` helpers), import from
  `../i18n/runtime`. Text produced there is read when it is produced, so pass
  it through `t()` at that point, as the store's error messages do.
- Keys are typed: `t()` only accepts keys that exist in `messages/en.ts`, and a
  template-literal key such as ``t(`nav.screens.${screen}`)`` is checked for
  every possible value. Prefer storing ids in data and looking up the label at
  render time over storing English labels.
- Never build sentences from fragments or by concatenating translated words.
  Put the whole sentence in one message with placeholders, so translators can
  reorder it.
- Placeholders: `"Step {step} of {total}"` → `t("…", { step: 1, total: 2 })`.
  Numbers are formatted for the locale (`12,345`); pass an identifier such as a
  question number as a string (`String(sequence)`) so it is not given digit
  grouping.
- Plurals: give the English message `_one` and `_other` forms and call it by
  its base key with a numeric `count`: `t("setup.questions", { count })`. Each
  translation provides the forms its language needs (`_other` only for Chinese
  and Japanese; `_few`/`_many` for, say, Polish).
- Rich text: wrap words in tags and supply elements for them, so word order
  stays the translator's: `rich("stats.header.tracking", { exam: (c) =>
  <strong>{c}</strong>, name })` for `"Here's how your <exam>{name}</exam> prep
  is tracking today."` Values are inserted as text, never as markup.
- Dates and numbers: use `formatDate`, `formatTime`, `formatDateTime`,
  `formatRelative`, `formatNumber` and `formatList` from the hook or runtime
  instead of `toLocale…String(undefined)`. Keep passing `timeZone` where the
  code did before.
- Accessible names belong in the resources too — an `aria-label` in English
  next to Japanese text is a bug.

## Adding a language

1. **Register it** in `apps/web/src/i18n/locales.ts`:

   ```ts
   { code: "ko", nativeName: "한국어", matches: ["ko"], load: () => import("./messages/ko").then((m) => m.default) }
   ```

   `matches` lists the lowercase browser tags it answers for (a preference is
   tried as written, then with trailing subtags removed, so `ko` also takes
   `ko-KR`); `excludes` lists tags of the same language that must not fall back
   to it.

2. **Add the resource** `apps/web/src/i18n/messages/ko.ts`, typed as
   `LocaleMessages` (see `ja.ts`). Copy the structure of `en.ts` and translate
   the values. The type rejects unknown keys; a key you have not translated yet
   can be left out and falls back to English while you work.

3. **Validate**:

   ```bash
   npm test --workspace apps/web
   ```

   `scripts/i18n.test.mjs` checks every registered locale against English: no
   missing or unknown keys, the plural categories `Intl.PluralRules` requires
   for that language, and identical placeholders and `<tag>`s. Then run
   `npm run typecheck` and check the screens at desktop and phone widths
   (`node apps/web/scripts/i18n.browser.mjs` covers detection, switching,
   persistence and phone overflow for the shipped languages).

No feature code changes: screens read the new language from the resources.

## Changing or adding messages

- Add new English text to `messages/en.ts` under the feature's namespace, then
  add the same key to every translation. The consistency test fails until each
  shipped language has it.
- Renaming or removing a key means changing its uses and every translation in
  the same change; TypeScript reports the uses.
- When the English meaning changes, update the translations too — the test
  cannot tell that a translation is stale.
- Keep terminology consistent with the existing translations (for example 练习
  / 練習 for Practice, 模拟考试 / 模擬試験 for mock exams, 错题本 / 誤答ノート for
  the wrong book, 知识点 / ナレッジポイント for Knowledge Points).
