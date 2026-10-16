# Question editor preview proximity

Partial progress on [#138](https://github.com/YIzhongyue/PrepDeck/issues/138).
This change only moves the existing Markdown preview beside the fields or behind
an explicit view switch. It does not change the component/JSON editor, learner
rendering, Markdown support, save semantics or keyboard shortcuts.

## Before

Reproduced on master `3b014d0c195dd8a209c293ce975f0a75fb5f11a6`
using the actual editor, an isolated loopback fixture and original synthetic
content. At 1440 × 1000 CSS pixels, **Show Markdown preview** left the preview
below every field, starting at y=1196. Scrolling it into view moved the drawer
body to scrollTop=1859; the fields and preview could not be reviewed together.

![Original editor after opening preview](question-editor-preview/before-wide.png)

## Responsive layout

The drawer uses two independently scrollable panes at 1100 CSS pixels and above.
At that boundary each pane has roughly 494px of usable width. Below it, Edit and
Preview buttons remain in the header while the current pane scrolls. Both panes
stay mounted so draft values, textarea selection and scroll positions survive
switching. Returning to Edit focuses the last edited control. Invalid saves
reveal the affected fields, and resizing keeps the focused pane available.

The breakpoint is based on space for the existing fields and preview; it is
not a new platform-wide breakpoint. Save, Save & add next, Cancel, Escape,
unsaved-navigation protection, Undo and stale-version recovery retain their
existing behavior. No migration or API change is needed.

## Reproduction

Run `npm run test:browser -- question-editor-preview question-authoring`.
Set `SCREENSHOT_DIR` to retain images. The preview test covers long content,
live rendering, 1100/1099/390px layouts, 720px zoom-equivalent reflow, repeated
switching, caret/focus/scroll retention, keyboard navigation, validation, Undo,
conflict recovery, a delayed failed save, cancellation and eventual successful
save. The authoring suite preserves the broader regression coverage from #140.

The automated fixture's 720 × 500 viewport models the CSS-pixel space of a
1440 × 1000 window at 200% zoom. Separately, the final Worker-served build was
tested using Chromium's actual tab zoom at 100% → 200% → 100% in a temporary
isolated test profile. `chrome.tabs.getZoom` confirmed factors 1 → 2 → 1 and
the page's `innerWidth` changed 1440 → 720 → 1440. The compact controls,
draft and focus survived the round trip. The temporary extension/profile was
used only for this check; no user browser settings were changed.

## Final local verification

Verified on Windows using Node.js 24.19.0 and Chromium 153.0.8010.12.

- Passed lint, workspace type checks, web build, 584 Worker tests and 67 shared
  tests. The ordinary workspace command hit two existing Windows dynamic-import
  path failures in `markdown-tables.test.mjs`; all 143 unchanged web tests passed
  with an ignored temporary hook converting drive-letter paths to file URLs.
- Passed `question-editor-preview`, `question-authoring` and `question-content`
  browser regressions. The existing authoring suite includes #140's validation,
  stale recovery and Undo checks and the unchanged component editor flows.
- Verified the final Worker-served build using a dedicated local admin and
  synthetic content: wide/390px layouts, repeated switching and caret/focus
  retention, validation from Preview, injected local 503 draft retention,
  cancelled discard and a successful save persisted in local D1. The test
  question was deleted afterward.
- Actual 200% browser zoom verified as described above. Screenshots and final
  diff inspected; independent read-only code review found no remaining defects.

No deployed bank, production service or private repository was accessed. No
screen-reader speech testing is claimed. Rollback is a single commit revert;
there are no schema, API or configuration changes.
The local built-app screenshots block external requests, so hosted fonts fall
back to system fonts; this change does not alter the application's fonts.

![Wide local editor](question-editor-preview/local-wide.png)

![390px Edit](question-editor-preview/local-phone-edit.png)

![390px Preview](question-editor-preview/local-phone-preview.png)

![Actual 200% tab zoom](question-editor-preview/local-zoom-200.png)
