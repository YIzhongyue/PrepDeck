# Component JSON diagnostics and preview context

[Documentation index](../README.md) · [Authoring guide](../guides/question-bank-authoring.md) · [Issue #152](https://github.com/YIzhongyue/PrepDeck/issues/152)

The component question editor explains malformed JSON with a one-based line and
column, and lists existing package-validation paths and messages below its JSON
field. String syntax errors identify the start of the invalid string token.
Exceptional inputs that exceed the diagnostic parser's limits receive a
location-unavailable message. Feedback is associated with the field and leaves
typing focus and raw JSON intact.

Native `JSON.parse` remains the parsing gate. `jsonc-parser` locates the first
syntax error after native parsing fails, with comments, trailing commas and
empty documents disallowed. Its recovered data is never used. Shared validation,
schema 2.0 and exactly one question determine whether the current draft is valid.

An invalid draft retains the most recent valid preview, marked **Preview is out
of date**. If no valid draft exists, an explicit empty state replaces the card.
**Save** stays available unless a request is pending. Invalid Save focuses the
current error summary and sends no request; Shift+Tab returns to the JSON field
without changing its selection or internal scroll. Correcting the draft updates
the preview and removes the notice. Only the current valid draft can supply a
save payload. Raw text, baseline and cached preview reset together when the exam
or question identity changes; an obsolete session's delayed save response cannot
close the new editor.

The existing component save/close behavior and shared discard/keyboard guards
are preserved. Explicit formatting, shell changes and new conflict recovery are
separate issues.

## Verification

Verified on Windows on 2026-10-17 with Node 24.19.0, Chromium
153.0.8010.12 and axe-core 4.14.0, on the #151 save/discard implementation.

The dedicated `component-preview-context` browser fixture uses the actual editor,
draft guard, parser and renderer with synthetic loopback-only data. At 1280px and
390px it checks three repeated valid/syntax-invalid/semantic-invalid cycles,
retained stem/options/correct response, exact raw text, textarea identity,
selection and scroll, pointer Save and both Ctrl/Cmd+S modifiers, focused current
diagnostics, keyboard return, correction, delayed/failing/successful saves and
zero invalid-save requests. Separate cases switch question and exam identities
without a parent key, including an outstanding old save. The defensive empty
state uses a deliberately invalid export at the fixture boundary; normal
production exports validate before returning, and all other cases use the real
exporter. The unchanged inspector unit tests verify syntax and semantic gates.

The adjacent `question-authoring`, `question-save-discard`,
`question-editor-preview` and `question-draft-preview` browser suites cover
normal authoring, assets, stale-save rejection, dismissal, standard preview and
lazy responsive panes. The dedicated fixture also checks contained layouts and
reports no axe WCAG A/AA violations in the stale state at either width.

These are browser, DOM and automated accessibility checks, not screen-reader
speech verification. External requests are blocked, so screenshots use fallback
fonts. Both screenshots were inspected visually and contain only synthetic data.

| State | Screenshot |
| --- | --- |
| Invalid JSON and retained preview, 1280px | [Desktop](component-preview-context/stale-1280.png) |
| Invalid JSON and retained preview, 390px | [Phone](component-preview-context/stale-390.png) |
