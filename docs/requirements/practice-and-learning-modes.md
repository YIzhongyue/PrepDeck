# Practice, mock exams and learning

[Documentation index](../README.md)

All three modes use the active user's [exam workspace](exam-workspaces.md).
Practice and Mock create attempts. Learning is review-only and never increments
answer counts or the Wrong Question Book merely because a question is viewed.
Question types and grading are defined in the [data contract](data-model-and-import-format.md).

The implementation is in [attempt routes](../../apps/worker/src/routes/attempts.ts),
[Learning detail](../../apps/worker/src/routes/learning.ts) and the web screens.
Mock drafts and flags persist incrementally; switching exams retains a resumable
mock and does not pause its timer. [Answer revisions](../guides/question-bank-authoring.md#answer-revisions-and-caches)
preserve past grades when admins correct a key.

Learning also implements **Copy as prompt** (implementation):
after the answer key loads it copies exam, question, options/answer format, correct
answers and any official explanation as Markdown. It omits current selections and
past attempts. See [prompt formatter](../../apps/web/src/lib/practicePrompt.ts).

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Questions under review

<a id="questions-under-review"></a>

Implementation ([issue #94](https://github.com/YIzhongyue/PrepDeck/issues/94)):
a question an administrator has flagged as still awaiting a human check
([review state](../guides/question-bank-authoring.md)) reaches learners marked
as such, and each mode can leave such questions out. Learners never see the
underlying field name; the screens say **Under review**.

- **Marking.** Wherever Practice, Mock or Learning shows such a question, an
  **Under review** badge sits beside its type in the question header, and a
  note above the stem reads: "This question is currently under review and may
  contain disputed or uncertain content." The Bookmarks and Wrong Question Book
  cards and the mock results breakdown carry the same badge.
- **Choice.** The Practice, Mock and Learning setup screens each offer
  **Questions under review: Include / Skip**, with how many the exam has, and
  their summaries state the choice. The row is absent from an exam with none.
- **Default: Include.** Leaving the option alone keeps the whole bank, with
  every such question marked. Each setup screen keeps its own choice, like its
  other filters; it lasts for the browser session and carries across exam
  switches, and is not stored on the server.
- **Skip** removes them from the question set the session is built from,
  combined with the other filters: every Practice source, Learning's filtered
  sequence and the Mock random draw. A Mock length the remaining bank cannot
  fill uses every remaining question and says so, as a smaller bank does under
  FR-4.1.
- **Explicit selections are not filtered.** A linked question (a Knowledge
  Point, a daily email or a Learning URL) opens in Learning with filters reset,
  so it is shown, marked, even when Learning was set to skip. **Practice these**
  and **Review** on the Bookmarks and Wrong Question Book screens practise
  exactly the listed questions.

## Studied status

<a id="studied-status"></a>

Implementation ([issue #119](https://github.com/YIzhongyue/PrepDeck/issues/119)):
each user has a studied or unstudied status for every question, stored per
user and question in `user_question_study_status` ([migration](../../migrations/0046_question_study_status.sql))
and shared across devices. **Studied means exposure**, not mastery and not a
correct answer. Four separate ideas must not be confused:

| Concept | Meaning | Source |
| --- | --- | --- |
| Resume position | Where Learning stopped in an exam (FR-14.9). Says nothing about which earlier questions were seen. | `learning_progress` |
| Studied status | The question was displayed in Learning, or the user recorded a real answer to it in Practice or Mock, and has not since marked it unstudied. | `user_question_study_status` |
| Attempted | The question has an answer row from Practice or Mock. Learning never creates one, so a question seen only in Learning is **studied but unattempted**. | `attempt_answers` |
| Mastery | Membership of the Wrong Question Book and its mastered flag. | `wrong_question_book` |

What changes the status:

| Event | Effect |
| --- | --- |
| Learning displays a question with its content (start, resume, Next, Back, a jump or a linked question) | Studied |
| The user presses **Studied** in Learning ("Mark as unstudied" / "Mark as studied") | The chosen status, always applied |
| A Practice answer is recorded, right or wrong | Studied |
| A Mock draft answer is saved, or a Mock is submitted with that question answered | Studied |
| A question is only prefetched, fails to load, is merely included in a session, is skipped, or a fill-in is left blank | No change |

- **A reset is durable.** "Mark as unstudied" keeps an explicit unstudied
  record; a question with no record is also unstudied. Each record has a
  revision that moves on every change. Learning's automatic mark is applied
  only against the revision the client last saw, and status writes for a
  question are sent in order, so a visit delayed or retried past a reset, a
  passive refresh of the exam, or a fetch that left the server earlier cannot
  undo it. Within one visit the question is marked at most once, so a reset
  stays in place while the question remains on screen. A later visit (moving
  away and back, starting a new session, or reloading the page) marks it again.
- **Practice and Mock mark on the server** where the answer is recorded, in
  the same transaction as a Practice answer or a Mock submission, so MCP
  practice counts too. A recorded answer is a new exposure and marks the
  question studied even after a reset; a replayed Practice answer, or a Mock
  draft saved again unchanged, is a retry and does not. Mock submission
  reconciles answered questions whose drafts were never marked, but leaves
  alone a reset made after the attempt started. "Answered" follows the same
  question-type rules as the Wrong Question Book.
- **Filters.** Learning and Practice setup each offer **Study status: Any
  status / Unstudied only / Studied only** (default Any status; the first
  option is not called "All questions" because Practice's source row has a card
  of that name). It combines with the exam, source, domain, difficulty and
  review filters, the counts and summary reflect it, and an empty result says
  whether the study status alone emptied it and offers to show every matching
  question. Each screen keeps its own choice for the browser session; a linked
  question resets Learning's filters as before. Mock has no such filter but
  contributes to the status.
- **Sessions are snapshots.** A Learning or Practice session's questions are
  fixed when it starts, so marking a question studied never removes the current
  question, skips the next one or disturbs Back in an "Unstudied only" session.
  Resume, start and jump work within the filtered questions.
- **Learning stays ungraded.** Marking creates no attempt and changes no
  accuracy, statistics, mastery or Wrong Question Book entry (FR-14.7).
- **Backfill.** The migration marks as studied every question with a genuinely
  answered Practice or Mock answer, and every non-empty draft answer in an
  unfinished Mock. Unanswered mock rows are not answers, and nothing is
  inferred from the resume position. It never overwrites an existing record.
- **Degraded load.** If the statuses cannot be loaded, the exam still opens
  and the setup screens say the study-status counts may be incomplete.

REST API (session-authenticated, scoped to the signed-in user; DTOs in
[studyStatus.ts](../../packages/shared/src/studyStatus.ts)):

| Request | Behavior |
| --- | --- |
| `GET /api/exams/:examId/study-status` | `{ examId, statuses: [{ questionId, status, revision, updatedAt }] }` for this exam's questions that have a record. |
| `PUT /api/exams/:examId/study-status/:questionId` with `{ status }` (`"studied"` or `"unstudied"`) | Manual choice; always applies. Returns `{ applied: true, status }`. |
| `POST /api/exams/:examId/study-status/:questionId/learning-view` with `{ expectedRevision }` | Learning's automatic mark; applies only while the stored revision equals `expectedRevision` (0 for no record). Returns `{ applied, status }` with the current record either way. |

`POST /api/attempts/:id/answers` and `PUT /api/attempts/:id/answers/:questionId`
also return the question's `studyStatus` after the write. The MCP practice
tools mark questions the same way but return their responses unchanged.

## Practice

<a id="fr-3-1"></a>

- **FR-3.1 (M):** A user starts practice in the active exam, filtering by tags, difficulty and source (all, unattempted, bookmarked or wrong questions), and by [studied status](#studied-status). Question-type filtering remains part of the original intent but has no dedicated control in the current Practice setup UI; treat that part as a gap.

  Domains search filters the displayed choices without changing the selection.
  For a non-empty search, **Select all results** replaces the current selection
  with every matching domain, including results outside the visible scroll area.
  Matching ignores case and surrounding whitespace. The action is disabled when
  there are no matches; clearing the search retains the selection. Selected
  domains match questions using OR, combined with the source and difficulty
  filters. Selecting no domains leaves the domain filter unrestricted.

<a id="fr-3-2"></a>

- **FR-3.2 (M):** Questions are presented one at a time with immediate or end-of-session feedback (configurable), no time limit, and free navigation (skip, go back, end session early).

  On desktop, questions and review details scroll independently when the viewport
  has enough height. Short viewports use natural-height content and page scrolling;
  mobile retains its single-column layout. Resizing after scrolling must not add
  the page's scroll offset to the panel height. Panels allow native scrolling to
  continue on the outer page at their boundaries when the page has room to scroll.

  On phones (under 620px wide), Practice and Learning give the question the
  viewport ([issue #78](https://github.com/YIzhongyue/PrepDeck/issues/78)): the
  page scrolls as one, with no scroller nested inside the question. A compact
  session header (question number, progress, bookmark, end/exit) sticks to the
  top while the app's top bar scrolls away, and Back and Next/Check answer stick
  just above the tab bar. Tags keep to one row that scrolls sideways. Moving to
  another question brings its start back into view below the header, and
  anything scrolled into view, such as a focused option, stops clear of both bars.

  Landscape phones (620–1099px wide and under 500px tall) use the same page
  scrolling in live Learning and Practice ([issue #80](https://github.com/YIzhongyue/PrepDeck/issues/80)).
  The global top bar, tab bar and sidebar are hidden during the session. Compact
  sticky session and action bars keep bookmark, Exit/End, Back and Next/Check
  answer reachable with touch targets at least 44px square. The question is
  visible before scrolling and gets at least 65% of the height once scrolled
  at 844×390 and 932×430. Navigation returns on exit or rotation; portrait
  phones, taller tablets, desktop widths (1100px and up), and Mock retain
  their existing layouts.

  A practice answer is graded and locked when it is first recorded. Re-submitting the same question replays the stored grading — including the answer key it was graded against, so the replayed result stays consistent with itself even if the key has since changed — rather than failing. That makes a retry after a lost response recover the feedback instead of leaving the client stuck on a question the server has already graded, while still refusing to revise the recorded answer.

  Keyboard shortcuts ([issue #50](https://github.com/YIzhongyue/PrepDeck/issues/50)):
  on choice questions, number keys 1–9 and option letters select options.
  **Enter** checks the answer only when **Check answer** would accept it (a
  complete answer), and moves to the next question once the answer is graded.
  Enter in the fill-in field checks that answer. **Shift+B** toggles the
  bookmark, because every plain letter can be an option. Enter on a focused
  option, button or link activates only that control, and held keys do not
  repeat a shortcut. The shortcut panel lists exactly the keys that apply to
  the current question.

<a id="fr-3-3"></a>

- **FR-3.3 (M):** Every answered question is recorded as an `attempt_answer` linked to an `attempt` of mode `practice`, including correctness and time spent, so it feeds statistics and the wrong-question book.

  An answer is validated against its question before anything is written, on
  the practice answer endpoint and the mock draft endpoint alike
  ([issue #39](https://github.com/YIzhongyue/PrepDeck/issues/39); rules in
  `answerProblem`, [`grading.ts`](../../packages/shared/src/grading.ts)). A
  fill-in is one value, because several guesses in one submission are not an
  answer. Single-choice and true/false answers name at most one option.
  Multiple-choice answers name each option at most once. Every ID must belong to
  the question. An ordering has one position per item, and a draft may still
  hold blanks and repeats while the learner arranges it. A matching answer is
  canonical `[leftId, rightId]` pairs, one per left item. An empty selection is
  always allowed, since it is how an answer is cleared. An answer has at most
  50 values of at most 1,000 characters each. `timeSpentSeconds` is omitted,
  `null`, or a whole number of seconds from 0 to 86,400. Anything else is
  refused with 400. Mock grading treats a draft saved before these checks (or
  one naming an option removed since) as unanswered, so such an attempt can
  still be submitted. Migration `0036` clears stored time values that break the
  rule.

  An answer feeds statistics as soon as it is graded, not when the session ends
  ([issue #40](https://github.com/YIzhongyue/PrepDeck/issues/40)): a reload, a
  closed tab or an expired session no longer hides answers from Statistics while
  the wrong book and practice sources already count them. Practice has no resume
  flow, so a session nobody ended is closed as a session (dated by its last
  answer, its duration running from start to last answer) when the same user
  starts practice in that exam after an hour without an answer, and by a daily
  sweep after a day. An answer sent to a session closed that way is refused, and
  the learner is told to start a new session.

<a id="fr-3-4"></a>

- **FR-3.4 (M):** During unanswered practice and timed mock answering, render questions without personal annotations, notes or answer-revealing explanations. Post-answer review may show them under [review rules](review-notes-and-annotations.md). The old reference to nonexistent FR-3.9 is corrected to FR-8.3; no FR-3.9 requirement was defined.

## Mock exams

<a id="fr-4-1"></a>

- **FR-4.1 (M):** A user can configure a mock exam: exam, number of questions, and time limit (sensible defaults per exam, editable by the user at start time). An attempt is capped at `MAX_ATTEMPT_QUESTIONS` (200) questions, because submission grades the whole attempt in one atomic transaction whose size that bounds; an exam with a larger question bank offers up to the cap rather than its full pool.

  The **Custom** format's fields keep exactly what the learner types and
  validate it instead of clamping each keystroke
  ([issue #55](https://github.com/YIzhongyue/PrepDeck/issues/55)). The question
  count must be a whole number from 1 to the questions available (at most the
  cap), and the time limit a whole number of minutes from 5 to 300. An empty or
  out-of-range value shows why, the summary shows a dash for it, and **Begin
  exam** stays disabled until it is valid, so an exam always starts with the
  values on screen.

<a id="fr-4-2"></a>

- **FR-4.2 (M):** Questions are drawn randomly without repetition within the same attempt from the exam's question pool. The optional original intent to reuse practice filters has no controls in the current Mock setup UI; the shipped setup configures question count and duration.

<a id="fr-4-3"></a>

- **FR-4.3 (M):** A visible countdown timer runs for the whole attempt; the exam auto-submits when time expires, preserving whatever has been answered so far. The deadline is `started_at + time_limit_seconds` and is **enforced by the server**, not only by the countdown: a timer the browser alone polices is not a time limit, because a sleeping tab, a skewed clock or a direct API call all walk straight past it. Draft answers are refused after the deadline plus a fixed grace window (`MOCK_SUBMIT_GRACE_SECONDS`), which exists because the client flushes queued draft writes immediately before submitting and those answers were genuinely made in time. Submission itself is never refused — an attempt that could not be submitted would be worse than one graded a few seconds late — and it grades the draft, which by then can only hold in-time answers. Time used is reported against the limit rather than against however long the tab stayed open.

<a id="fr-4-4"></a>

- **FR-4.4 (M):** On submission (manual or automatic), the user sees a results summary: score, pass/fail against a configurable passing threshold, time used, and a per-question breakdown (correct/incorrect, user's answer vs. correct answer) with the option to jump into AI explanations from there.

  A manual submission is confirmed first in a modal dialog that states how many
  questions are answered and flagged
  ([issue #51](https://github.com/YIzhongyue/PrepDeck/issues/51)). The dialog
  focuses **Keep going**, keeps keyboard focus inside itself and makes the exam
  behind it inert, so no answer can change while it is open. Escape and a click
  on the backdrop both mean Keep going, and closing returns focus to the
  control that opened it.

  Answers read as the question's own text wherever they are summarised: the
  practice feedback banner, the results breakdown, Learning's history, the
  answer-revision notice and the admin and import previews
  ([issue #43](https://github.com/YIzhongyue/PrepDeck/issues/43)). A matching
  answer reads "HTTPS → 443; SSH → 22" rather than its stored `["L1","R2"]`
  pairs, and an ordering "1. … 2. …" rather than item IDs. Choice and fill-in
  answers are shown as before. A question whose content is not available falls
  back to the stored IDs.

<a id="fr-4-5"></a>

- **FR-4.5 (M):** Mock exam attempts are recorded exactly like practice attempts (mode = `mock`) and count toward statistics and the wrong-question book.

## Learning mode

<a id="fr-14-1"></a>

- **FR-14.1 (M):** A user can start a Learning session by selecting an exam and a starting **question sequence number** (the question's stable ordinal position within that exam's question list — see [Data model](data-model-and-import-format.md)). The session then presents that exam's questions **in sequence order**, beginning at the chosen position.

<a id="fr-14-2"></a>

- **FR-14.2 (M):** Optional filters (category/tag), as in Practice Mode (FR-3.1), may be applied to a Learning session; when a filter is active, "sequence order" refers to the filtered subset's order, not the full exam. Learning also filters by [studied status](#studied-status), and marks each question it displays as studied.

<a id="fr-14-3"></a>

- **FR-14.3 (M):** For each question, Learning Mode immediately displays — with no reveal/submit step — the question stem and options, with the correct answer(s) indicated in place.

<a id="fr-14-4"></a>

- **FR-14.4 (M):** Learning displays the current user's historical practice/mock answers, correctness and timestamps, or a not-yet-attempted state. The REST detail endpoint returns the recorded history for that user/question in descending answer-time order; this differs from bounded MCP history/discovery operations. Historical answer revisions distinguish the key used then from the current key.

<a id="fr-14-5"></a>

- **FR-14.5 (M):** Learning displays the official explanation and available cached AI explanations with cache-first behavior. The page loads these through its detail/cache requests; it does not promise that all review material comes in one HTTP response. On a selected-model cache miss, users can request generation with their own loaded key.

<a id="fr-14-6"></a>

- **FR-14.6 (M):** For each question, Learning Mode displays the current user's own Annotations ([Annotations](review-notes-and-annotations.md)) and Notes ([Question notes](review-notes-and-annotations.md)), plus other users' `shared` Notes currently visible to them per FR-11.4 — exactly as these already appear in other review contexts. Learning Mode counts as a "review context" for the purposes of FR-8.3 and FR-11.6, so a user may also create/edit annotations and notes while in a Learning session.

<a id="fr-14-7"></a>

- **FR-14.7 (M):** Because every answer is already visible, **no `attempt` or `attempt_answer` row is created by viewing a question in Learning Mode**; Learning sessions do not feed the Wrong Question Book ([related specification](review-notes-and-annotations.md)) or the Statistics Dashboard's ([related specification](statistics-and-progress.md)) answer counts. Historical attempts from Practice/Mock, shown per FR-14.4, are unaffected.

<a id="fr-14-8"></a>

- **FR-14.8 (M):** Within a Learning session, the user can move to the next/previous question, or jump directly to a different sequence number, at any time.

<a id="fr-14-9"></a>

- **FR-14.9 (S):** PrepDeck remembers, per user and per exam, the sequence number of the last question viewed in Learning Mode, and offers to resume from there the next time the user starts a Learning session for that exam (in addition to letting them pick a different starting number per FR-14.1). The resume position is only a position: which questions were actually viewed is the separate [studied status](#studied-status).

<a id="fr-14-10"></a>

- **FR-14.10 (M):** A user can bookmark/unbookmark (FR-6.1) any question encountered during a Learning session.
