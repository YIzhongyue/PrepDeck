# Component JSON formatting

[Documentation index](../README.md) · [Authoring guide](../guides/question-bank-authoring.md) · [Issue #153](https://github.com/YIzhongyue/PrepDeck/issues/153)

**Format JSON** changes the raw component draft to two-space indentation using
the existing `jsonc-parser` formatter's whitespace edits. Native `JSON.parse`
checks syntax only; its decoded value never supplies the formatted source.
Duplicate keys, number lexemes, escaped strings, IDs, unknown fields and ordering
survive verbatim. The formatter retains the source's existing line-ending style.
Malformed JSON is unchanged; syntactically valid but invalid packages still
format and retain their diagnostics and most recent valid preview.

The action is keyboard reachable immediately before the JSON field. It restores
that same field's focus, maps UTF-16 selection offsets and direction, and restores
field and pane scroll where their bounds allow. Repeated formatting is a no-op.
Formatting changes dirty state through the existing raw-text comparison, never
the saved baseline or revision. Pending saves disable formatting. The existing
save shortcuts, current-draft validation, discard confirmation, failure recovery
and preview identity isolation remain in effect.

This preservation contract applies to **Format JSON only**. Ordinary **Save**
continues through the existing parsing, validation and persistence normalization;
this change does not promise preservation of duplicate keys or original numeric
and string tokens in persisted data. There is no autosave or format-on-type.

## Verification

Verified locally on Windows on 2026-10-17 with Node 24.19.0 and Chromium, using
only original synthetic loopback fixtures. The dedicated `component-json-format`
browser regression mounts the actual editor, parser, preview and draft guard at
1440px and 390px. It checks:

- Exact raw-token identity, duplicate keys, large/exponent numbers and escapes;
  malformed and semantically invalid drafts, unchanged diagnostics and retained preview.
- Pointer and Enter/Space activation, backward selection containing an emoji,
  original textarea identity, focus, internal/pane scrolling, and repeated no-op.
- Clean/dirty baselines, keep-editing/discard/reopen, no formatting requests,
  pending request guards, failed save retention, retry and saved revision reuse.
- Contained layout and no axe WCAG A/AA violations or browser exceptions.

The focused formatter unit tests compare token kinds and exact source substrings,
including whitespace within strings, escapes, nesting, duplicate keys, huge
integers, `1e400`, `-0`, trailing zeros, CRLF and idempotence. They check UTF-16
caret positions throughout tokens, both selection directions, replaced whitespace
and strict rejection of malformed/JSONC input. Adjacent browser regressions cover
component preview context, question save/discard, and full question authoring.

Reproduce with `node --test apps/web/scripts/format-json-source.test.mjs` and
`npm run test:browser -- component-json-format component-preview-context question-save-discard question-authoring`.
Set `SCREENSHOT_DIR` to capture screenshots. External requests are blocked;
captures use fallback fonts. These are DOM/browser and automated accessibility
checks, not screen-reader speech verification.

Both captures were visually inspected. They intentionally show the retained
scroll position and selection after formatting an unsaved draft.

| State | Screenshot |
| --- | --- |
| Formatted draft and retained selection, 1440px | [Desktop](component-json-format/formatted-1440.png) |
| Formatted draft and retained selection, 390px | [Phone](component-json-format/formatted-390.png) |
