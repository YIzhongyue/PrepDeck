# Knowledge Point control borders

[Documentation index](../README.md) · [Editor guide](../guides/knowledge-point-editor.md) · [Issue #127](https://github.com/YIzhongyue/PrepDeck/issues/127)

The Knowledge Point editor used an undefined `--color-control-border` variable.
For the code-language and image-alt fields, pending-upload placeholder and
Markdown source textarea, this invalidated the entire border shorthand. The
Add tag chip instead fell back to the text colour. Link and new-group inputs
already used a temporary fallback to `--color-divider`.

All five references now use the established `--color-divider` directly, matching
the existing input and chip convention. The temporary fallback is removed.
Border widths, solid/dashed styles, radii, focus/error colours and the five
theme palettes are unchanged.

## Browser evidence

The new assertions were first run against the unchanged CSS on 2026-10-17 JST.
They failed on the light-theme code-language field at 1280px: its computed
border style was `none`, where the authored control required `solid`.

After the substitutions, `npm run test:browser -- knowledge-points` passed in
102.8 seconds. It renders the actual editor against an isolated synthetic HTTP
fixture and covers all ten combinations of **light, cream, sage, clay, dusk**
and **1280px/375px**:

- Code-language and image-alt inputs, Markdown source, link URL and new-group
  fields have nonzero solid borders on every side.
- Add tag and the held, in-progress upload placeholder have dashed borders.
- Resting controls are blurred before checking their resolved divider colour;
  focus styling cannot conceal the original defect.
- Source, link, group and Add tag retain their existing accent focus colour.
  Invalid link URLs retain their danger-coloured border.
- Control views remain within the viewport without horizontal page overflow.

The same run passed the existing editing, autosave, recovery, upload, metadata,
navigation and mobile cases, exercising 48 acknowledged or failed save attempts.
No test assertions were weakened.

Final lint, workspace type checks and the web build also passed. Worker tests
passed 584/584, shared tests 67/67 and web tests 143/143. The web run used the
ignored Windows file-URL import adapter for the existing renderer-test loader
limitation; its assertions were unchanged.

The cloud-independent local smoke test and unchanged five-theme accessibility
scan passed. The final Worker-served build also passed a separate matrix for
all seven controls in all ten theme/width combinations, using a dedicated local
admin and a synthetic note stored in local D1. A locally intercepted upload
response held the real placeholder open, then returned a synthetic failure;
dismissing it retained the note. The temporary note was deleted afterward.

Verified on Windows with Node.js 24.19.0 and Chromium 153.0.8010.12. Heavy checks
ran sequentially. The final diff and screenshots were inspected; independent
read-only review found no actionable defects. No production service or private
repository was accessed. Screen-reader testing is not claimed.

## Local application views

These views use synthetic local content in the Worker-served build. The
controls are at rest so their restored boundaries can be inspected. External
requests are blocked in these screenshots, so hosted fonts use local fallbacks;
this change does not alter fonts.

| Theme | Desktop, 1280px | Phone, 375px |
| --- | --- | --- |
| Light | [Desktop](knowledge-point-borders/local-light-1280.png) | [Phone](knowledge-point-borders/local-light-375.png) |
| Dusk | [Desktop](knowledge-point-borders/local-dusk-1280.png) | [Phone](knowledge-point-borders/local-dusk-375.png) |

## Source and upload details

The cropped screenshots below come from the browser regression's synthetic
fixture at 375px. The upload response is held open to preserve the real
in-progress placeholder while the theme and width checks run.

| Theme | Markdown source | Pending upload |
| --- | --- | --- |
| Light | [Source](knowledge-point-borders/source-light-375.png) | [Upload](knowledge-point-borders/upload-light-375.png) |
| Cream | [Source](knowledge-point-borders/source-cream-375.png) | [Upload](knowledge-point-borders/upload-cream-375.png) |
| Sage | [Source](knowledge-point-borders/source-sage-375.png) | [Upload](knowledge-point-borders/upload-sage-375.png) |
| Clay | [Source](knowledge-point-borders/source-clay-375.png) | [Upload](knowledge-point-borders/upload-clay-375.png) |
| Dusk | [Source](knowledge-point-borders/source-dusk-375.png) | [Upload](knowledge-point-borders/upload-dusk-375.png) |
