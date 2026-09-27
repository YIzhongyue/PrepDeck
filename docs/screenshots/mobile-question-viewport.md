# Phone question layout

[Documentation index](../README.md) · [Practice and Learning modes](../requirements/practice-and-learning-modes.md#fr-3-2)

Synthetic fixture captured on 2026-09-27 in the real application shell at
390×844 (iPhone 14) and 375×667 (iPhone SE). The question is a long made-up
scenario with three domain tags. No real exam content is shown. The "before"
images are from `master` before
[issue #78](https://github.com/YIzhongyue/PrepDeck/issues/78).

On phones, Learning and Practice used to pin the question card to the space
left between the top bar, the session header and the tab bar. The stem then
scrolled inside the card, in as little as 108px on an iPhone SE. Now the page
scrolls as one. A compact session header sticks to the top once the top bar
has scrolled away, and Back and Next or Check answer stick just above the tab
bar. Tags keep to one row that scrolls sideways.

| | Before | After |
|---|---|---|
| Learning, 390×844 | ![Learning before: the stem gets 285px between the tags and a two-row footer](mobile-question-viewport/learning-before.png) | ![Learning after: the stem fills the screen above a one-row action bar](mobile-question-viewport/learning-after.png) |
| Practice, 390×844 | ![Practice before: header, stats and three tag rows push the stem down](mobile-question-viewport/practice-before.png) | ![Practice after: the score sits under the title and the tags keep to one row](mobile-question-viewport/practice-after.png) |
| Learning, 375×667 | ![Learning on iPhone SE before: four lines of the stem are visible](mobile-question-viewport/learning-before-se.png) | ![Learning on iPhone SE after: the stem runs down to the action bar](mobile-question-viewport/learning-after-se.png) |

Scrolled through a graded Practice question, the session header and the
actions stay in place:

![Practice after grading, scrolled: the header is stuck to the top and Next question to the tab bar](mobile-question-viewport/practice-graded-scrolled.png)

`apps/web/scripts/question-card-layout.browser.mjs` checks the following at 390px:

- Only the page scrolls.
- The tags keep to one focusable row.
- On pages at least three screens long, the actions are at the bottom at eleven
  scroll positions from the top to the end, and the header stays at the top.
- A new question starts below the header.
- An option scrolled into view stops clear of both bars.

The actions come after the question and its review panels in the page, and
the check at the first scroll position is what shows they still stick from the
start. `apps/web/scripts/exam-workspace.browser.mjs` makes the same sweep at
375px in the real shell, where the actions must sit on the tab bar.

`PLAYWRIGHT_BROWSER=webkit` runs the first suite in WebKit, Safari's engine,
after `npx playwright install webkit`. That does not replace a pass on a real
iPhone. With `QUESTION_CARD_SCREENSHOTS` set, the suite writes a capture of
each screen at every width it tests:

```sh
PLAYWRIGHT_BROWSER=webkit node apps/web/scripts/question-card-layout.browser.mjs
QUESTION_CARD_SCREENSHOTS=docs/screenshots node apps/web/scripts/question-card-layout.browser.mjs
```
