# Shared UI components (Untitled UI React)

[Documentation index](../README.md)

PrepDeck's shared form primitives come from
[Untitled UI React](https://www.untitledui.com/react/components) (MIT). The
component source is vendored into this repository rather than installed as a
package, which is how Untitled UI is designed to be consumed: you copy the
source in, own it, and re-run the CLI to update it.

This guide covers where that source lives, how its design tokens are bound to
PrepDeck's own tokens so every component follows the five color schemes, how to
add a component, and what is still to be migrated. Introduced by
issue implementation.

## Where things live

| Path | Owner | Contents |
| --- | --- | --- |
| [`apps/web/src/components/base/`](../../apps/web/src/components/base/) | Untitled UI | Vendored component source, kept at upstream's paths and file names. |
| [`apps/web/src/utils/`](../../apps/web/src/utils/) | Untitled UI | `cx` (a `tailwind-merge` wrapper) and `isReactComponent`, which the components import. |
| [`apps/web/src/hooks/use-resize-observer.ts`](../../apps/web/src/hooks/use-resize-observer.ts) | Untitled UI | Used by the combo box. |
| [`apps/web/src/styles/untitled-ui.css`](../../apps/web/src/styles/untitled-ui.css) | PrepDeck | Tailwind entry point and the token mapping. The only file to edit when a component needs a color PrepDeck has not bound yet. |
| [`apps/web/src/styles/tokens.css`](../../apps/web/src/styles/tokens.css) | PrepDeck | Still the source of truth for color, type, spacing, radius and elevation. |

Vendored files use kebab-case names and import each other through the `@/`
alias, which [`vite.config.ts`](../../apps/web/vite.config.ts) and
[`tsconfig.json`](../../apps/web/tsconfig.json) both map to `apps/web/src`.
PrepDeck's own components keep their existing PascalCase names and relative
imports, so `@/components/base/...` in a screen always means "third-party
primitive".

Currently vendored: `Button`, `Input` (with `TextField`, `InputBase`, `Label`,
`HintText`), `TextArea`, `Checkbox`, `RadioGroup`/`RadioButton`, `Select`
(with `Select.ComboBox`, `Select.Item`, `Popover`), `Toggle`, `Tooltip`,
`Avatar`, `Badge` (with `BadgeWithDot` and the rest of the badge family),
`ProgressBar`/`ProgressBarBase`, `ProgressBarCircle`/`ProgressBarHalfCircle`,
and the chart helpers in `components/application/charts/charts-base.tsx`.
`Avatar` and `Checkbox` are pulled in as dependencies of `Select`; `Dot`
(`components/foundations/dot-icon.tsx`) is a dependency of `Badge`.

The chart helpers are the only vendored file outside `components/base/`,
because that is where upstream keeps them, and they are also the only ones
with a runtime dependency of their own: [Recharts](https://recharts.org)
(MIT), added to `apps/web` by the CLI. The two Statistics charts are the only
place it is used, and both are behind `React.lazy`, so Recharts ships as its
own chunk rather than in the entry bundle.

## How theming works

Untitled UI defines semantic tokens (`bg-primary`, `text-secondary`,
`ring-brand`, `border-error_subtle`, …) on top of a raw palette. PrepDeck
replaces that raw palette wholesale: `untitled-ui.css` binds every semantic
token directly to a PrepDeck variable, so there is no Untitled UI palette in
the build at all.

```css
@theme inline {
    --background-color-brand-solid: var(--color-accent);
    --text-color-primary: var(--color-text);
    --ring-color-error_subtle: var(--color-danger-border);
}
```

Three properties of this arrangement matter, and breaking any of them breaks
scheme switching:

- **`@theme inline`, not `@theme`.** Inlining makes `bg-brand-solid` compile to
  `background-color: var(--color-accent)`. A plain `@theme` would emit an
  intermediate variable on `:root`; because custom properties substitute at
  computed-value time, that intermediate would freeze whichever palette
  `<html>` carried when the page loaded, and `[data-pd-theme]` further down the
  tree would no longer have any effect.
- **One step per binding.** A binding may not point at another Untitled UI
  token, or an intermediate reappears. Expand the chain by hand instead.
- **`<html>` carries the live scheme.** `public/theme-init.js` sets
  `data-pd-theme` before React mounts, and
  [`PrepDeckContext`](../../apps/web/src/store/PrepDeckContext.tsx) keeps it in
  step with the current choice afterwards. Overlays that React Aria portals
  into `<body>` sit outside the app shell's own `[data-pd-theme]` element and
  read their palette from `<html>`, so a stale attribute there would strand
  open menus, tooltips and dialogs on the previous scheme.

No dark-mode variant is defined and Untitled UI's `.dark-mode` class is unused.
PrepDeck's neutral and accent ramps already invert for Dusk — `--color-neutral-900`
is the lightest tone there — so Untitled UI's light-mode definitions produce
correct dark-scheme output on their own.

### Token map

Every binding is listed in `untitled-ui.css`; this is the shape of it.

| Untitled UI | PrepDeck | Notes |
| --- | --- | --- |
| `bg-primary`, `bg-primary_alt` | `--color-bg` | Page and control surface. |
| `bg-secondary` | `--color-surface` | Card surface. |
| `bg-tertiary`, `bg-quaternary` | `--color-neutral-100/200` | Recessed fills. |
| `bg-brand-solid`, `bg-brand-solid_hover` | `--color-accent`, `--color-accent-600` | Matches `.btn-primary`. |
| `bg-brand-primary`, `bg-brand-secondary` | `--color-accent-100/200` | Selected-state washes. |
| `text-primary` … `text-quaternary` | `--color-text` at 100/85/70/55% | Same ramp the existing screens mix by hand. |
| `text-white`, `text-*_on-brand` | `--color-bg` | Only the `text-*` namespace is rebound, so `bg-white` and `border-white/12` stay true white. This is what keeps Dusk's light accent legible, exactly as `.btn-primary` does. |
| `fg-white` | `--color-bg` | Checkbox tick, toggle knob. |
| `border/ring/outline-primary` | `--color-divider` | |
| `border/ring/outline-brand` | `--color-accent` | |
| `*-error*` | `--color-danger*` | |
| `*-warning*` | `--color-warning*` | |
| `*-success*` | `--color-accent-2-*` | |
| `focus-ring` | `--color-accent` | Same ring as the global `:focus-visible`. |
| `utility-brand-*` | `--color-accent-*` | Badge fills, rings and dots. |
| `utility-neutral-*` | `--color-neutral-*` | The gray badge. |
| `utility-red-*` / `utility-yellow-*` | `--color-danger*` / `--color-warning*` | Error and warning badges. |
| `utility-green-*` | `--color-accent-2-*` | Success badges. |

Only the five badge hues PrepDeck renders are bound. The other seven
(`slate`, `sky`, `blue`, `indigo`, `purple`, `pink`, `orange`) have no
PrepDeck equivalent and are deliberately left unbound: an unbound ramp emits
no CSS, so using one of those colours renders an unstyled badge rather than
failing the build. Bind a ramp before using it, and add it to `?kit`.

`--text-display-*` is also defined (in the plain `@theme` block, since it is a
size and not a colour), because the progress circles use it.

`--color-danger*` and `--color-warning*` are light-surface quartets in
`tokens.css` with inverted values for Dusk in `app.css`, so validation states
stay readable on the one dark scheme.

### Two deliberate constraints

- **Preflight is not imported.** Tailwind's reset removes list markers and link
  underlines that PrepDeck's Markdown previews take from the browser defaults,
  and resets the `h1`–`h6` sizes `tokens.css` sets. `untitled-ui.css` re-states
  only the few rules the imported components rely on — `font`/`color: inherit`
  and a zeroed border on form controls — inside `@layer base`. Everything in
  `tokens.css`, `app.css` and every inline `style` is unlayered and therefore
  still wins, so no existing control changed.
- **PrepDeck's radius and elevation scales are prefixed.** They are now
  `--pd-radius-{sm,md,lg}` and `--pd-shadow-{sm,md,lg}`, because Tailwind owns
  `--radius-*` and `--shadow-*` and both sets live on `:root`, where one name
  can only hold one value. Use the `--pd-` names in PrepDeck CSS and inline
  styles; use Tailwind's `rounded-*`/`shadow-*` inside vendored components.

## Adding or updating a component

```bash
cd apps/web
npx untitledui@latest add <component>          # add
npx untitledui@latest add <component> --overwrite   # update in place
npx untitledui@latest upgrade                  # update everything
```

Then:

1. Run `npm run typecheck --workspace apps/web`. This repository compiles with
   `noUncheckedIndexedAccess`, which the Untitled UI starter does not, so new
   source occasionally needs a small local fix.
2. Check the new component for semantic tokens `untitled-ui.css` does not bind
   yet. An unbound token silently produces no CSS, so the element renders
   unstyled rather than failing the build. Add the binding in the same one-step
   form as the rest.
3. Add the component to the `?kit` route in
   [`settings.browser.mjs`](../../apps/web/scripts/settings.browser.mjs), which
   is what proves the bindings hold in all five schemes.

### Local changes to vendored files

Keep this list current; `upgrade` overwrites these files.

| File | Change |
| --- | --- |
| `src/components/base/avatar/utils.ts` | `getInitials` guards the destructured name parts, which `noUncheckedIndexedAccess` types as possibly `undefined`. |
| `src/components/application/charts/charts-base.tsx` | `ChartLegendContent` uses `payload.slice().reverse()` instead of `toReversed()`, which is ES2023 and outside this workspace's `lib`. |

### Licensing

The vendored components and `@untitledui/icons` are MIT
([upstream licence](https://github.com/untitleduico/react/blob/main/LICENSE)),
which permits use and modification with the copyright notice retained. Untitled
UI also sells PRO components; none are used here, and `npx untitledui login`
is deliberately not part of any workflow. Identify a PRO component and its
licence terms separately before introducing one.

## Modals and the top layer

A modal has to dim the whole window, and `position: fixed` cannot promise that:
it is only ever as large as its containing block, and any ancestor with a
`transform`, `filter` or `contain` becomes that block. Every screen here opens
with a `pd-rise` transform animation, and those screens used to run it with
`animation-fill-mode: both` — a fill that leaves the transform applied forever.
So a dialog rendered inside one dimmed its own content column and left the
sidebar and page margins bright. They all run `backwards` now, which is the
note on `@keyframes pd-rise` in `app.css`; use it for any new entrance
animation.

[`components/ModalLayer.tsx`](../../apps/web/src/components/ModalLayer.tsx) is
the way out. It renders a `<dialog>` and calls `showModal()`, which promotes the
element to the browser's top layer — outside every ancestor's containing block,
so the wash covers the window whatever the page behind it is laid out like. The
top layer also makes the rest of the document inert and routes Escape to the
dialog, which no `div` backdrop does. The `.modal-layer` rules in
[`tokens.css`](../../apps/web/src/styles/tokens.css) stretch the box over the
viewport and paint the wash through `::backdrop`; theme tokens still reach it by
inheritance from where the component sits in the tree.

Wrap the panel and pass `onClose` — the backdrop click and Escape both go
through it, so the state that renders the dialog stays in step with the element.
Name it with `label` or `labelledBy`, and point `describedBy` at the text a
screen reader should announce on opening, such as a confirmation's consequences:

```tsx
<ModalLayer label="Import questions" onClose={close}>
  <div className="dialog">…</div>
</ModalLayer>
```

The top layer also replaces what a `div` backdrop has to hand-roll. The three
Knowledge Point modals dropped `useDialogFocus` when they moved here: initial
focus, the Tab trap, Escape and focus restore are all what `showModal()` already
does, and `inert` covers the screen reader as well, which `aria-modal` alone
never did.

The mock exam's submit confirmation (`ConfirmDialog`) moved here too
([issue #51](https://github.com/YIzhongyue/PrepDeck/issues/51)). As a plain `div`
it neither took focus nor kept Tab out of the exam behind it, so a keyboard user
could still change answers while being asked to confirm an irreversible submit.
It focuses its **Keep going** button explicitly after opening, rather than
relying on the browser's initial-focus choice.

`QuestionEditorDialog` drives its own `<dialog>` for the same reason, because it
also needs a drawer animation and an unsaved-changes guard. The overlays left on
a plain fixed `div` are not broken, but each of them avoids the problem its own
way: the `TabBar` sheet and the exam-switching status render at the application
root, above the animated screens rather than inside one, while
`StudyPlanDialog` and `MediaDialog` portal out to reach that same place — and
`MediaDialog` then marks its new siblings `inert` by hand. Fold them into this
layer when you touch them; the top layer does all of that by itself.

One thing to keep in mind when adding a panel: keep it inside the layer's
content box. `.modal-layer > *` caps it, because a centred box taller than its
scroll container cannot be scrolled back to its own top edge.

## Migration status

`Settings` is migrated and is the reference for how these components are used:
labelled fields, inline validation, disabled and loading buttons, a portaled
select popover, radio cards and toggles. It is also code-split, so
`react-aria-components` loads only when that screen opens.

`McpTokensCard` is migrated with it, because it renders inside Settings — and
inside the Admin console, which therefore picks up the shared controls too. Its
stylesheet keeps only layout rules now; appearance comes from the primitives.

`Statistics` (`screens/Dashboard.tsx` and `components/statistics/`) is migrated
by issue implementation, and is the
reference for badges, progress indicators and charts. Two things about it are
local to that screen rather than general policy:

- **Its headings use the body face.** `components/statistics/statistics.css`
  rebinds `h1`–`h4` under `.pd-stats` only. The global heading face is still
  Caprasimo; a display serif is not legible at the card-title sizes a metric
  grid needs.
- **Its layout is CSS-driven, not `bp`-driven.** `Dashboard` takes no
  `Breakpoints` prop. The media queries in that stylesheet sit at the same
  900px/620px thresholds as `lib/responsive.ts`, and unlike a window-width
  prop they also hold when the content column is narrower than the window.

Still on PrepDeck's own controls, in rough priority order:

| Screen or component | What it needs |
| --- | --- |
| `screens/Admin.tsx` | The largest remaining form surface: inputs, selects and buttons. |
| `screens/PracticeSetup.tsx`, `MockSetup.tsx`, `LearningSetup.tsx` | Segmented pills and a range slider. |
| `components/QuestionEditorDialog.tsx`, `QuestionImportDialog.tsx` | Dialogs, inputs and textareas. |
| `components/ConfirmDialog.tsx` | Would move to Untitled UI's `Modal`. |

Not planned for migration: the Knowledge Point Markdown editor and its toolbar
(TipTap-specific), the theme swatch picker, and the segmented pill groups on
Settings (provider, questions-per-email), which have no Untitled UI equivalent
that preserves their appearance. Untitled UI's `ButtonGroup` is the candidate
if those are revisited.

### Known gaps, inherited rather than introduced

Both of these come from the brand palette, predate this work and affect the
existing screens identically. They are recorded here rather than fixed, because
fixing either means changing how the whole application looks and should be a
deliberate decision of its own.

**Clay has no accent ramp.** The scheme defines `--color-accent` but not
`--color-accent-100`…`900`, so accent washes fall back to the Light scheme's
blues. `PracticeSetup`'s selected source pill has always rendered that way.

**On-accent labels fall short of WCAG AA in three schemes.** PrepDeck paints
text on a solid accent fill with the page background — `.btn-primary` has
always done this, and the mapping follows it so migrated and unmigrated buttons
match. The resulting ratios are:

| Scheme | `--color-bg` on `--color-accent` |
| --- | --- |
| Light | 5.17:1 |
| Cream | 3.03:1 |
| Sage | 3.28:1 |
| Clay | 3.60:1 |
| Dusk | 5.57:1 |

Cream, Sage and Clay clear 3:1 but not the 4.5:1 that AA asks for at this text
size, so the kit sweep holds solid-fill labels to 3:1 and everything on a page
or field surface to 4.5:1. Raising the floor means darkening those three
accents for every button in the app.

## Verification

```bash
npm run typecheck --workspace apps/web
npm run build --workspace apps/web
node apps/web/scripts/settings.browser.mjs
node apps/web/scripts/statistics.browser.mjs
node apps/web/scripts/admin-console.browser.mjs
```

The browser suite renders the real `Settings` screen against a local HTTP
fixture and checks accessible labels, inline validation, keyboard operation and
a visible focus ring, disabled and loading states, that an open portaled
popover repaints when the scheme changes without closing or reloading, that the
scheme survives a reload, and that all five schemes render without overflow at
1280px and 375px.

Its `?kit` route then mounts every vendored primitive — including `Checkbox`,
`TextArea` and `Tooltip`, which no migrated screen renders yet — in each scheme,
and measures the colors the browser actually resolved. It asserts that a filled
checkbox and an on toggle never collapse into the surface behind them, that a
disabled control is dimmed, that no two schemes paint the kit identically, and
that text clears its contrast floor. Add a component to the kit when you vendor
one; a token that was never bound produces no CSS at all, so the element simply
renders unstyled and only a check like this catches it.

`statistics.browser.mjs` renders the real Statistics screen the same way, and
is where the badge, progress and chart primitives are exercised against live
data: it checks that the concept's hierarchy renders from the fixture rather
than from hardcoded figures, that readiness/coverage/accuracy/pass line stay
four distinct numbers, that empty and partial-failure states each have their
own wording, that a practice action carries its whole filter set, that both
charts expose a data table, and that all five schemes render at 1280/834/375px
without page overflow.

`admin-console.browser.mjs` covers the modal layer, and needs the whole shell to
do it (`knowledge-points.browser.mjs` makes the same measurement against the
Knowledge Point editor, which is the other screen that hosts its own modals): it opens the Admin console's **New provider** dialog inside the real
sidebar-and-content layout, measures the dimmed layer against the viewport, and
hit-tests all four corners, because the failure it guards against is a backdrop
that stops at the content column. It also checks that the wash is the app's own
token-resolved color, that a background control takes neither focus nor a click,
and that Escape and a backdrop click both close the dialog and hand the page
back — at 1280px and at 390px.

Set `SETTINGS_SCREENSHOTS`, `STATISTICS_SCREENSHOTS` (or `SCREENSHOT_DIR`) to
write the captures in [`docs/screenshots/`](../screenshots/README.md).
