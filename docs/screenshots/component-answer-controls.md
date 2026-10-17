# Existing sorting and matching answer controls

Implementation evidence for #166 under #155, following approved discovery #161.
Only synthetic data is used. The real ComponentQuestionEditor, shared validators,
content renderers, draft guard and native textarea run in local Chromium against
a loopback HTTP fixture. The fixture never contacts a bank or production service.

## Behavior and preservation boundary

Sorting moves the answer sequence, not option declarations. Matching displays
actual rich left/right content and IDs and permits many left items to select the
same right item. Identical IDs across sides resolve by side. The editor preview
also uses side-specific bodies; the pre-existing learner renderer is untouched.

Both views share the exact mounted textarea. Switching does not serialize, save,
create history entries or change the dirty baseline. A native text edit applies
only the model's answer-token change, retaining earlier typing and native undo/
redo. Unsupported/refused native edits fail without a value-setter fallback.
The JSON selection and scroll, and the selected answer control, survive switches.

Raw-save rejection of duplicate keys is deliberately separate: #167 / #168.
This PR's visual eligibility gate rejects duplicates; #168 owns the raw-save
parser change. The owner approved sequential merge and combined validation on
2026-10-17. #168 merged first as `2572641dc583facbf561e276ee22fa1e64c902d7`,
then its master baseline was integrated into #170. The PRs retain separate scopes.

Unknown fields remain intact in JSON; the current schema rejects them, so they
do not become editable controls. Malformed, unsupported and multi-question input
also stays JSON-only. Packages beyond the existing 5 MiB import limit stay JSON.
Existing normalized save/export semantics are unchanged; preservation is of the
editor draft outside the deliberately replaced answer tokens, not original
import-file spelling through storage.

## Verification

Local machine: Windows, Node 24.19.0, Chromium 153.0.8010.12, 2026-10-17.

- `node --test apps/web/scripts/component-answer-controls.test.mjs`: 10 passed.
  Includes exact CRLF/whitespace/escape/number preservation, inverse and no-op
  edits, many-to-one and side-collision matches, reversed pair order, unchanged
  declarations/references/assets/scoring, normalization/export round trips,
  invalid/unknown input, min/max counts, maximum 256 KiB asset and 19K stem,
  over-budget source and parser depth failure.
- `node scripts/browser-regressions.mjs component-answer-controls`: passed at
  1440px and 390px, with touch emulation at 390px. Exercises keyboard Up/Down and
  native selects, position announcements/focus, exact source/dirty mode changes,
  shared native undo/redo and older typing, unavailable/refused/throwing native
  editing, failed/pending saves, duplicate save/dismissal guards, failed latest
  load, repeated conflicts and revision baselines, cancelled/confirmed discard,
  recovery to an unsupported type, JSON-only gates, maximum 20 options/long IDs,
  rich side-specific table/code/figure content, corrected save and reopening.
- Adjacent `component-preview-context`, `component-json-format`,
  `component-stale-recovery`, `question-editor-preview` and
  `question-save-discard` browser suites passed.
- Repository lint, workspace types and web build passed (existing large-chunk
  advisory). Tests ran with concurrency 1: all 584 Worker and 67 shared tests
  passed. Full web unit suite: 178 passed, 2 failed in unchanged
  `markdown-tables.test.mjs` due to Windows ESM absolute-path imports. Both
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` failures also reproduce on master 4e4da0f;
  this is not a passing full-suite claim.
- Axe WCAG A/AA DOM scan passed. Keyboard behavior and DOM status/labels were
  checked; **screen-reader speech and real touch-device acceptance were not**.
- Zero learning/AI requests or storage mutations. Existing Google Fonts CSS
  requests were fulfilled with empty local CSS; all other external requests
  were blocked and asserted absent. Only explicit fixture question saves write.

The maximum-count browser case found overflowing long IDs in the editor preview;
scoped wrapping was added and the case passed. Screenshots were visually inspected
for visible focus, readable labels, rich content, wrapping and fixed save controls.

| Sorting | Matching |
| --- | --- |
| [Desktop](component-answer-controls/answer-ordering-1440.png) | [Desktop](component-answer-controls/answer-matching-1440.png) |
| [390px](component-answer-controls/answer-ordering-390.png) | [390px](component-answer-controls/answer-matching-390.png) |

## Risks and rollback

Native editing support varies by browser. Chromium is verified locally; other
engines and actual assistive-technology speech remain acceptance limitations.
If a native edit cannot run, the source remains editable in JSON. Revert this
PR to remove visual controls; no schema, migration, configuration or stored-data
cleanup is needed. The independent duplicate-key validation PR can remain.

## Approved combined integration

After owner approval, #168 merged at `2572641dc583facbf561e276ee22fa1e64c902d7`.
Integration commit `eff0487dfb032c2863efc8c175f1db99f5a403b8` combines that baseline
with reviewed #170 head `5afda813fcae651c969af4e9fbd57d82e8dfb101` without conflicts.
No product-source compatibility fix was needed: the stable patch ID of the
`apps/web/src` delta against master remains
`32cea2c7dd7ce49c6e9b0b2d5669219a6752536d`, identical to the reviewed change.

Combined checks on this Windows computer, run sequentially with synthetic data:

- Repository lint, workspace type checks and web build passed (same chunk advisory).
- Web unit suite: 179 passed, only the two confirmed baseline Windows ESM-path
  failures in `markdown-tables.test.mjs`; no new failure.
- All 584 Worker and 67 shared tests passed with test concurrency 1.
- Tracked-source safety check passed (833 files); all eight local configuration/
  export tests passed using isolated synthetic fixtures.
- All seven real Chromium suites passed together: `component-duplicate-keys`,
  `component-answer-controls`, `component-json-format`, `component-preview-context`,
  `component-stale-recovery`, `question-save-discard`, `question-editor-preview`.
  The two new suites include 1440px/390px checks; adjacent suites also exercise
  short landscape and responsive/zoom cases. The same native undo, exact raw
  preservation, failed saves, revision conflicts and recovery paths were exercised
  with both slices present.

Logs remain local under `.worktrees/answer-controls/tmp/integration-155/`.
The PR's refreshed CI must pass before its expected-head-guarded merge. This
record does not claim a completed production deployment or screen-reader speech
acceptance. The private downstream and its production services were not accessed.
