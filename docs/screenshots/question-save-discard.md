# Question save and discard workflow

[Documentation index](../README.md) · [Authoring guide](../guides/question-bank-authoring.md)

Issue [#151](https://github.com/YIzhongyue/PrepDeck/issues/151) adds visible dirty
state, Ctrl/Cmd+S, standard saves that keep an existing question open, and accessible
discard confirmation. The fixture uses the actual QuestionsPanel, editors and
PrepDeckProvider against synthetic loopback data. It never uses a deployed bank.

Reproduce with `node scripts/browser-regressions.mjs question-save-discard`.
Set `SCREENSHOT_DIR` to capture the two views below.

![Saved standard question at wide width](question-save-discard/saved-wide.png)

![Discard confirmation at 390px](question-save-discard/discard-phone.png)

The regression checks keyboard and pointer saves, returned revisions, subsequent
dirty edits, delayed/failed/stale requests, validation, native unload protection,
confirmation keyboard trapping and exact field selection/scroll restoration.
Closing after saving returns focus to the current Edit control even when the
question-list refresh replaced the original button. The save status shares the
footer action row so short landscape layouts retain their editable pane.
Each of the six provider navigation entry points is cancelled and then resumed;
a second pending request and an unmounted editor cannot approve navigation.
Continuous creation and component close-on-save behavior are also exercised.
Companion authoring, preview and field-layout suites retain their original
diagnostic, Undo, stable-ID, responsive and lazy-preview assertions.

Screenshots demonstrate local rendering; screen-reader speech was not verified.
