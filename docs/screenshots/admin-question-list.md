# Admin question list on phones

[Documentation index](../README.md) · [Authoring behavior](../guides/question-bank-authoring.md)

Evidence for [#169](https://github.com/YIzhongyue/PrepDeck/issues/169), captured on
2026-10-17 using synthetic accounts/questions and a loopback HTTP fixture. The
fixture renders the actual Admin screen, QuestionsPanel, editors and application
shell, including its sticky header and fixed bottom navigation. No authenticated
bank or production service is used. External requests are blocked; screenshots
use local fallback fonts. The owner's original screenshots/content are not used.

## Reproduction and change

On unchanged master `8d42d938805a3637cf2e1cab4052dc72aedd4060`, the flex row kept
the 74-pixel sequence column and action controls beside a shrinking summary.
At 390px in Chromium, the synthetic summary had only **6.8px** of width and the
row grew to **5,400px**. Its type badge overlapped Edit and long tags were clipped.
The 360px filters also fell into one column.

Below 620px the row now stacks number, summary and actions. Metadata wraps and
all content remains visible. The toolbar retains its controls and DOM order:
full-width search, two filter columns and 44-pixel controls. No disclosure,
truncation, filtering option or task behavior was added. Desktop retains its
column arrangement. The existing archived-row opacity also failed the contrast
scan; the row now uses the existing muted-text token and keeps the Archived badge.

| Chromium measurement | Before | After |
| --- | ---: | ---: |
| 360px summary width | 198px | 302px |
| 390px summary width | 6.8px | 332px |
| 430px summary width | 46.8px | 372px |
| 390px first-row height | 5,400px | 631px |
| 360px filter height | 414px | 299px |
| 1440px summary width | 785px | 785px |

The consistent mobile grid and larger controls make the filter block 299px high
at all three phone widths; at 390/430px this is slightly taller than before.
No filters are hidden. Full [before](admin-question-list/before-chromium-metrics.json)
and [after](admin-question-list/after-chromium-metrics.json) measurements are retained.

## Inspected screenshots

| View | Before | After |
| --- | --- | --- |
| 360px toolbar | [Before](admin-question-list/before-chromium-360-toolbar.png) | [After](admin-question-list/after-chromium-360-toolbar.png) |
| 390px row | [Before](admin-question-list/before-chromium-390-row.png) | [After](admin-question-list/after-chromium-390-row.png) |
| 430px row | [Before](admin-question-list/before-chromium-430-row.png) | [After](admin-question-list/after-chromium-430-row.png) |
| 1440px desktop | [Before](admin-question-list/before-chromium-1440-toolbar.png) | [After](admin-question-list/after-chromium-1440-toolbar.png) |

Additional captures: [768px tablet](admin-question-list/after-chromium-768-toolbar.png)
and [390px last page above navigation](admin-question-list/after-chromium-390-last-page.png).
Windows WebKit: [390px row](admin-question-list/after-webkit-390-row.png) and
[360px toolbar](admin-question-list/after-webkit-360-toolbar.png).

## Verification

Windows, Node 24.19.0, Chromium 153.0.8010.12 and Windows WebKit 26.6. The new
suite passed in both engines with no browser errors; all six adjacent/new
Chromium suites passed together (`question-authoring`, `admin-console`,
`component-stale-recovery`, `question-editor-preview`, `question-save-discard`,
`admin-question-list`). Browser viewports are 360, 390, 430, 768 and 1440 CSS pixels
wide, each 900px high. The reproducible suite is
`node scripts/browser-regressions.mjs admin-question-list`; set
`PLAYWRIGHT_BROWSER=webkit` for the installed WebKit engine. `SCREENSHOT_DIR`
optionally captures each viewport, and `CAPTURE_BASELINE=1` captures measurements
without asserting the fixed layout when the fixture is run against the old source.

The regression exercises:

- Full-width prose; contained long IDs, spaced/unbroken tags and status badges;
  no overlapping row content/actions or page overflow; phone touch-target sizes.
- Search by stem, each existing filter, empty results, clear/reset, selecting the
  intended row, repeated Edit/close and focus restoration with filters retained.
- Next and Go to page, last-row Edit/return, and visible controls above the real
  navigation. Extra bottom-navigation padding simulates a safe-area allowance
  and verifies the shell's measured content padding follows it.
- Tab/Shift+Tab/Enter and visible focus, touch emulation, failed save retaining
  the draft, successful save, cancelled/confirmed discard, archive/restore,
  cancelled deletion, server-refused deletion, failed list retry and filtered export.
- Axe WCAG A/AA DOM scan of the list and no unexpected browser errors or API routes.

Sequential local checks passed: repository lint, workspace types, web build
(existing large-chunk advisory), all 584 Worker tests and all 67 shared tests.
The web unit suite has 179 passes and the same two baseline Windows
`ERR_UNSUPPORTED_ESM_URL_SCHEME` failures in `markdown-tables.test.mjs`; that file
is unchanged. This is not a passing full-Windows-suite claim. The new list suite
is registered in the normal Chromium shards and the existing WebKit CI step.

Actual screen-reader speech, physical touch devices, iOS Safari, Android Chrome,
browser chrome/virtual-keyboard interaction and real device safe-area insets are
not verified. Windows WebKit is an engine check, not Safari-device acceptance.

## Risks and rollback

The change is list markup classes and scoped CSS; data, handlers, API contracts,
pagination/filter semantics, permissions and destructive safeguards stay intact.
Native editor behavior is covered by adjacent regression suites. Phone styles
are restricted to list controls so they do not alter the nested editor/dialog.
Long content remains fully visible and can still require scrolling. Reverting
the PR restores the previous layout without a migration or data cleanup.
