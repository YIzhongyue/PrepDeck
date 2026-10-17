# Visible labels and accessible names

[Documentation index](../README.md) · [Issue #129](https://github.com/YIzhongyue/PrepDeck/issues/129)

Setup controls, tag filters, exam selectors and copy actions include their
visible text in their accessible names, in reading order. The labels, layouts,
selection state and activation handlers are unchanged.

| Control | Accessible name example |
| --- | --- |
| Setup choice | `Bookmarked 4 Questions you saved for later` |
| Difficulty | `Easy 5 questions` |
| Domain/tag chip | `Security 2 questions` |
| Expanded exam selector | `local-examples — Select exam, current exam: Local practice examples` |
| Compact exam selector | `Select exam, current exam: Local practice examples` |
| Copy with text | `Copy as prompt`, `Copied`, or `Copy failed`, matching its visible state |
| Compact copy | `Copy as prompt` in every state; the existing live region announces success/failure |

Choice descriptions appear once in the name rather than being repeated as an
accessible description. The copy action's longer Markdown explanation remains
available as a tooltip. An expanded exam selector with no exams retains the
visible name `Select an exam`; both selector layouts remain disabled.

## Browser regressions

The focused regression uses actual components and synthetic loopback data.
It checks exact browser-computed names, counts of zero/one/many, keyboard and
pointer selection, pressed states, desktop/compact copy success/failure/retry,
live feedback, and exam selection/Escape/focus restoration with slugs different
from full names. Existing suites continue to exercise the real app shell and
workspace, filter, study-status and question-layout behavior.

Targeted commands:

```text
npm run test:browser -- visible-accessible-names
npm run test:browser -- exam-workspace question-card-layout review-lists under-review study-status setup-layout
```

Both commands passed on Windows with Node.js 24.19.0 and Chromium 153.0.8010.12:
the focused regression and all six affected browser suites passed. These
browser checks do not establish screen-reader speech behavior.

## Full application verification

Lint, workspace type checks, browser-runner tests, 584 Worker tests, 67 shared
tests and the web build passed. All 143 web tests passed with an ignored Windows
file-URL import adapter for the existing drive-letter loader limitation.

The full local smoke passed against the dedicated local test account and seeded
synthetic content. It includes the unchanged accessibility scan across all five
themes with axe-core 4.14.0. No entries were added to `KNOWN_EXCEPTIONS`, and the
rule scope and severity filtering are unchanged.

Additional checks against the final Worker-served build passed at 1280px/light
and 375px/dusk. They cover expanded Learning, Practice and Mock setup controls,
exam-selector Escape/focus restoration, difficulty selection with Space/Enter,
and copy idle/success/error/retry with focus and live feedback. Each setup and
copy state passed the same accessibility scan with no serious or critical
violations, and neither viewport had horizontal document overflow. Clipboard
success and failure were isolated synthetic responses in the browser page; the
real Learning flow generated the copied prompt.

The four screenshots below were inspected after layout animations settled.
External requests were blocked during local browser verification, so fonts use
their configured fallbacks. This change does not modify typography.

| View | Screenshot |
| --- | --- |
| Desktop setup, light theme | [1280px setup](visible-accessible-names/setup-light-1280.png) |
| Desktop copy failure and focus | [1280px copy feedback](visible-accessible-names/copy-error-light-1280.png) |
| Narrow setup, dusk theme | [375px setup](visible-accessible-names/setup-dusk-375.png) |
| Narrow copy failure and focus | [375px copy feedback](visible-accessible-names/copy-error-dusk-375.png) |

All local checks ran sequentially. An independent read-only review found no
actionable defects. No production services or data were accessed.
