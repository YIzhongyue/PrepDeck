# Statistics and progress

[Documentation index](../README.md)

The dashboard scopes learning statistics to user + active exam. Core metrics,
activity heatmap and mock history are implemented; they are not pending merely
because their original priority was Should. See
[statistics computation](../../apps/worker/src/lib/learningStats.ts),
[shared derivations](../../packages/shared/src/statistics.ts),
[routes](../../apps/worker/src/routes/stats.ts),
[view model](../../apps/web/src/lib/statistics.ts) and
[dashboard](../../apps/web/src/screens/Dashboard.tsx).

Completed attempts feed dashboard answer totals and accuracy; uncompleted drafts
are not completed activity. Bank coverage/distinct answered questions differ from
total answer events (repeated answers can increase the latter). Learning resume
is separate from attempt statistics. Preserve these definitions across REST and
User MCP; both use shared learning-statistics services.

Statistics cache keys include the user, the exam and the payload's schema
version; completion invalidates the cache, with a one-hour TTL fallback. A
payload cached by an earlier schema version is never served. The question
catalog's shared cache never contains personal bookmarks or wrong-answer state.
See [architecture](../architecture/system-overview.md#caches).

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Statistics

<a id="fr-9-1"></a>

- **FR-9.1 (M):** A user can view, per exam: total questions attempted, overall accuracy %, accuracy trend over time, breakdown by category/tag and by difficulty, and mock-exam score history.

<a id="fr-9-2"></a>

- **FR-9.2 (S):** A user can see time-based study activity (e.g., a calendar/heatmap of days practiced, average session length).

<a id="fr-9-3"></a>

- **FR-9.3 (S):** A user can record an exam date and a weekly study-time goal per exam, and see progress against both. Neither is derived; both are optional and independently clearable.

## Definitions

These names mean one thing each, everywhere. They are easy to conflate and the
screen is wrong if any two of them are merged
(issue implementation).

| Figure | Definition |
| --- | --- |
| Answer events | Every graded answer in a completed attempt. Answering one question three times is three events. |
| Answered questions | Distinct question ids answered in completed attempts. |
| Bank size | Questions currently in the exam's bank. The coverage denominator. |
| Coverage | Answered questions **that still exist in the bank**, over bank size. Answers to deleted questions drop out, so coverage can never exceed 100%. |
| Accuracy | Correct answer events over answer events. Never an average of daily percentages. |
| Pass line | The exam's own `pass_mark_pct`. Null for exams that do not set one, and then every pass comparison is omitted rather than defaulted. |
| Readiness | A difficulty-weighted projection, defined below. Not coverage, not accuracy, and not a predicted exam score. |
| New this week | Questions answered for the **first time** inside the trailing 7-day window. Re-answering a known question adds nothing. |
| Recorded study time | Summed `attempts.duration_seconds` for completed sessions. Session time, not measured engagement. |

### Calendar policy

Every day bucket, week boundary, comparison window and countdown is a **UTC**
calendar day, and weeks run Monday to Sunday. This follows `accuracyTrend`,
which has always bucketed on `substr(completed_at, 1, 10)` of a UTC timestamp.
Moving any one figure to a local calendar means moving all of them, which is
coordinated API work rather than a display choice.

### Readiness, method v1

Defined in [`packages/shared/src/statistics.ts`](../../packages/shared/src/statistics.ts)
and versioned, so a score can always be traced to the method that produced it.

```
weightedAccuracy = Σ(w_d · correct_d) / Σ(w_d · attempted_d)   over answer events
coverage         = answered questions in bank / bank size
readiness        = weightedAccuracy · (coverage + (1 − coverage) · 0.75)
```

with difficulty weights easy 0.8, medium 1.0, hard 1.3, and unspecified treated
as medium rather than dropped.

Two properties are deliberate:

- **Unseen questions are unknown, not wrong.** They are credited at 75% of
  demonstrated accuracy. Zero would make readiness collapse into coverage; one
  would make coverage irrelevant.
- **A score is withheld below its sample floor** — 30 answered questions and 40
  answer events. Below that the screen shows bank coverage, labelled as
  coverage, and says why. A user who has answered four questions has no
  measurable readiness.

Readiness is **not** accompanied by a claim that practising N more questions
closes a gap. No such relationship has been validated against outcomes here, so
the screen states the distance to the pass line and stops.

### Where to focus

Tags are ranked by `max(0, passMark − accuracy) · (1 + 0.3 · hard share of the
tag's eligible questions)`, ties broken by lower accuracy, then more eligible
questions, then tag name — so the order is identical for two users with
identical data.

- A question with several tags counts once for **each** of them, so per-tag
  counts deliberately do not sum to the bank size.
- **Eligible** means unseen, or in the unmastered wrong book: exactly the set a
  row's practice action would draw from, which is why the button can label the
  count ("Practice 47").
- Practice uses the explicit `focus` source ("Unattempted + wrong") for these
  actions, so its pool and the started attempt exclude answered, non-wrong and
  mastered questions rather than merely limiting the size of an all-question pool.
- Below 5 answer events a tag is listed but never presented as a measured
  weakness; it ranks after every tag that has evidence, and shows "needs 5
  answers" rather than 0%.
- Exactly one tag may be called "weakest", and only when it is actually behind.

### What the wrong book does not claim

The Wrong book card reports how many unmastered entries exist, how many have
been missed more than once, and how many were missed in the last seven days.
It does **not** say anything is "due": PrepDeck has no review-scheduling model
(no next-review date, no interval), and equating every wrong answer with a due
review would invent one.

### Missing data is not zero

- Statistics, activity and study-plan requests have independent loading and
  error states. Only successful responses may display zero/empty metrics;
  retrying a failed request leaves successful cards intact.
- A day with no sessions studied for zero seconds. A day whose sessions
  recorded no duration is **unavailable**, and renders as "?" rather than as an
  empty bar.
- A weekly average is taken over sessions that recorded a duration, never over
  all of them, and the count of sessions missing one is shown.
- An accuracy delta is null unless **both** comparison windows have answers.
  "No previous activity" is not a delta of zero.
- A tag with no answers has a null accuracy, not 0%.

## Study plan

`user_exam_preferences` (migration 0031) holds an optional exam date and weekly
goal per user and exam, read and written through
`/api/exams/:examId/preferences`. With no date set the header offers "Set exam
date"; with no goal the Study time card offers "Set weekly goal". Neither is
ever defaulted to an invented value.

Editing is available only after the study plan has loaded successfully. The
editor sends only edited fields; clearing a field explicitly sends `null`.
An untouched weekly goal retains its exact integer-minute value, including
fractional-hour goals such as 15 or 45 minutes.

## Verification

```bash
npm run test --workspace packages/shared     # readiness, focus ranking, study week
node --test apps/web/scripts/statistics-model.test.mjs
node apps/web/scripts/statistics.browser.mjs # the real screen, five schemes, three widths
```
