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

## Practice

<a id="fr-3-1"></a>

- **FR-3.1 (M):** A user starts practice in the active exam, filtering by tags, difficulty and source (all, unattempted, bookmarked or wrong questions). Question-type filtering remains part of the original intent but has no dedicated control in the current Practice setup UI; treat that part as a gap.

  Domains search filters the displayed choices without changing the selection.
  For a non-empty search, **Select all results** replaces the current selection
  with every matching domain, including results outside the visible scroll area.
  Matching ignores case and surrounding whitespace. The action is disabled when
  there are no matches; clearing the search retains the selection. Selected
  domains match questions using OR, combined with the source and difficulty
  filters. Selecting no domains leaves the domain filter unrestricted.

<a id="fr-3-2"></a>

- **FR-3.2 (M):** Questions are presented one at a time with immediate or end-of-session feedback (configurable), no time limit, and free navigation (skip, go back, end session early).

  A practice answer is graded and locked when it is first recorded. Re-submitting the same question replays the stored grading — including the answer key it was graded against, so the replayed result stays consistent with itself even if the key has since changed — rather than failing. That makes a retry after a lost response recover the feedback instead of leaving the client stuck on a question the server has already graded, while still refusing to revise the recorded answer.

<a id="fr-3-3"></a>

- **FR-3.3 (M):** Every answered question is recorded as an `attempt_answer` linked to an `attempt` of mode `practice`, including correctness and time spent, so it feeds statistics and the wrong-question book.

<a id="fr-3-4"></a>

- **FR-3.4 (M):** During unanswered practice and timed mock answering, render questions without personal annotations, notes or answer-revealing explanations. Post-answer review may show them under [review rules](review-notes-and-annotations.md). The old reference to nonexistent FR-3.9 is corrected to FR-8.3; no FR-3.9 requirement was defined.

## Mock exams

<a id="fr-4-1"></a>

- **FR-4.1 (M):** A user can configure a mock exam: exam, number of questions, and time limit (sensible defaults per exam, editable by the user at start time). An attempt is capped at `MAX_ATTEMPT_QUESTIONS` (200) questions, because submission grades the whole attempt in one atomic transaction whose size that bounds; an exam with a larger question bank offers up to the cap rather than its full pool.

<a id="fr-4-2"></a>

- **FR-4.2 (M):** Questions are drawn randomly without repetition within the same attempt from the exam's question pool. The optional original intent to reuse practice filters has no controls in the current Mock setup UI; the shipped setup configures question count and duration.

<a id="fr-4-3"></a>

- **FR-4.3 (M):** A visible countdown timer runs for the whole attempt; the exam auto-submits when time expires, preserving whatever has been answered so far. The deadline is `started_at + time_limit_seconds` and is **enforced by the server**, not only by the countdown: a timer the browser alone polices is not a time limit, because a sleeping tab, a skewed clock or a direct API call all walk straight past it. Draft answers are refused after the deadline plus a fixed grace window (`MOCK_SUBMIT_GRACE_SECONDS`), which exists because the client flushes queued draft writes immediately before submitting and those answers were genuinely made in time. Submission itself is never refused — an attempt that could not be submitted would be worse than one graded a few seconds late — and it grades the draft, which by then can only hold in-time answers. Time used is reported against the limit rather than against however long the tab stayed open.

<a id="fr-4-4"></a>

- **FR-4.4 (M):** On submission (manual or automatic), the user sees a results summary: score, pass/fail against a configurable passing threshold, time used, and a per-question breakdown (correct/incorrect, user's answer vs. correct answer) with the option to jump into AI explanations from there.

<a id="fr-4-5"></a>

- **FR-4.5 (M):** Mock exam attempts are recorded exactly like practice attempts (mode = `mock`) and count toward statistics and the wrong-question book.

## Learning mode

<a id="fr-14-1"></a>

- **FR-14.1 (M):** A user can start a Learning session by selecting an exam and a starting **question sequence number** (the question's stable ordinal position within that exam's question list — see [Data model](data-model-and-import-format.md)). The session then presents that exam's questions **in sequence order**, beginning at the chosen position.

<a id="fr-14-2"></a>

- **FR-14.2 (M):** Optional filters (category/tag), as in Practice Mode (FR-3.1), may be applied to a Learning session; when a filter is active, "sequence order" refers to the filtered subset's order, not the full exam.

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

- **FR-14.9 (S):** PrepDeck remembers, per user and per exam, the sequence number of the last question viewed in Learning Mode, and offers to resume from there the next time the user starts a Learning session for that exam (in addition to letting them pick a different starting number per FR-14.1).

<a id="fr-14-10"></a>

- **FR-14.10 (M):** A user can bookmark/unbookmark (FR-6.1) any question encountered during a Learning session.
