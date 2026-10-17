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

Pending final local checks and browser screenshots.
