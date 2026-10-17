# Component question JSON diagnostics

[Documentation index](../README.md) · [Issue #139](https://github.com/YIzhongyue/PrepDeck/issues/139)

The component question editor explains malformed JSON with a one-based line and
column, and lists existing package-validation paths and messages below its JSON
field. String syntax errors identify the start of the invalid string token.
Exceptional inputs that exceed the diagnostic parser's limits receive an honest
location-unavailable message. Feedback is associated with the field and leaves
typing focus and raw JSON intact.

Native `JSON.parse` remains the parsing gate. `jsonc-parser` 3.3.1 is used only
after native parsing fails to locate the first error, with comments, trailing
commas and empty documents disallowed. Its recovered data is never used. Existing
shared validation, schema 2.0 and exactly one question still determine whether
the preview appears and Save becomes enabled.

This is partial progress on #139. Invalid drafts still hide the preview and
disable Save. Save/close behavior, failed-save draft retention, revision checks,
rendering and dismissal guards remain unchanged. Formatting, shortcuts, retained
stale previews, enabled-invalid-save navigation, shell changes and new conflict
recovery are outside this change.

## Verification

Verified on Windows on 2026-10-17 with Node 24.19.0, Chromium
153.0.8010.12 and axe-core 4.14.0, after incorporating master `4ca4175`.

- Lint, types and the web-only build passed. Worker 584, shared 67 and web 150
  unit tests passed. The Windows web run used an untracked Node resolve hook
  converting drive-letter imports to file URLs for the existing table tests;
  test assertions and committed source were unchanged.
- `question-authoring`, `question-editor-preview` and
  `visible-accessible-names` browser suites passed. Coverage includes syntax
  locations, CRLF input, unmodified validation paths/messages, missing fields,
  duplicate IDs, bad references/scoring, long errors, keyboard focus, correction,
  stale rejection, save success and existing dismissal/Undo behavior.
- The full local smoke test passed, including local D1, R2, KV, Durable Object,
  rate limits, scheduled cleanup, simulated email and the five-theme browser
  accessibility scan.
- The built app was additionally exercised through a local Worker and local D1
  with a disposable synthetic component question. The actual UI showed syntax
  line 2, column 13, kept invalid JSON verbatim, hid invalid previews, disabled
  Save and retained editing focus. Tab skipped disabled Save. Long validation
  messages wrapped at 1280px and 390px without horizontal overflow; axe found no
  violations in the checked error and corrected states. A concurrent local API
  update produced an actual stale-save rejection without losing the draft. After
  refreshing the question list, the corrected draft saved at the fresh revision
  with its figure assets intact. The synthetic question was deleted afterward.

These are browser, DOM and automated accessibility checks, not screen-reader
speech verification. External requests were blocked, so screenshots use the
app's configured fallback fonts. All screenshots below were inspected visually
and contain synthetic local data.

| State | Screenshot |
| --- | --- |
| Syntax location, 1280px | [Desktop syntax error](component-json-errors/syntax-1280.png) |
| Long semantic errors, 1280px | [Desktop validation errors](component-json-errors/semantic-1280.png) |
| Long semantic errors, 390px | [Narrow validation errors](component-json-errors/semantic-390.png) |
