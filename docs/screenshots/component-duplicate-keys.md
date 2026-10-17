# Component raw JSON duplicate-key save validation

Local evidence for #167 (parent #155), Windows, Node 24.19.0, Chromium 153.0.8010.12.

The editor rejects repeated object keys before generating a preview/save payload,
including escaped-equivalent names and duplicates in unknown nested data. Errors
show a property path and both one-based line/column locations. Up to 50 duplicate
errors are shown; incomplete inspection fails closed. Source text stays intact.
This is an editor-only check, not a change to imports, API inputs or stored data.

Verification on 2026-10-17, synthetic loopback fixtures only:

- `node --test apps/web/scripts/component-question-draft.test.mjs`: 8 passed.
- `node apps/web/scripts/component-duplicate-keys.browser.mjs`: passed at 1440px
  and 390px. Rejected click/keyboard saves send no request, keep exact text, focus
  the errors and retain discard cancellation. Corrected JSON saves successfully.
- `node scripts/browser-regressions.mjs component-preview-context component-json-format component-stale-recovery`:
  all 3 passed. Formatting retains duplicate tokens but updates their diagnostic
  locations; conflicts, retained preview, failures, native undo/redo and recovery
  remain covered. Existing tests that intentionally saved duplicate keys now
  distinguish blocked ambiguous input from valid conflict/recovery input.
- Repository lint, workspace types and web build passed. Build reports the usual
  large-chunk advisory. All 584 Worker tests passed, with test concurrency 1.
- Full web unit suite: 169 passed, 2 failed in unchanged `markdown-tables.test.mjs`:
  Windows absolute paths are imported as ESM URLs (`ERR_UNSUPPORTED_ESM_URL_SCHEME`).
  The same two failures reproduce on master 4e4da0f. This is not a passing full suite.

Automated accessibility/keyboard checks do not establish screen-reader speech or
real touch-device acceptance. No production content or services were accessed.

Risk: previously accepted ambiguous source now needs correction. Very deep JSON
that cannot be inspected is rejected with an explanation. Rollback: revert this
PR; no migration/configuration/cleanup is required (this restores last-key-wins).
