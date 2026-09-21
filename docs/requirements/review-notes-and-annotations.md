# Review, notes and annotations

[Documentation index](../README.md)

These are distinct records: wrong answers drive the Wrong Question Book;
bookmarks are explicit flags; annotations mark a private text span; question notes
are whole-question text that can be private or shared. Freestanding concept notes
belong to [Knowledge Points](knowledge-points.md).

Review lists, badges and bulk-practice actions use the active [exam workspace](exam-workspaces.md).
Annotation and question-note list APIs additionally support account-wide reads
when `examId` is omitted, while preserving ownership and shared-note visibility.

implementation is implemented: annotations
can be filtered/sorted, and Settings gives the three stable highlight slots
`hl1`/`hl2`/`hl3` personal aliases. Aliases change labels, not stored mark identity;
theme colors remain presentation. See [annotation routes](../../apps/worker/src/routes/annotations.ts)
and [alias contract](../../packages/shared/src/annotationSettings.ts).

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Wrong Question Book

<a id="fr-5-1"></a>

- **FR-5.1 (M):** Any question a user has **answered** incorrectly (in practice or mock mode) is automatically added to that user's Wrong Question Book, with a running "times wrong" counter and "last wrong at" timestamp. A question left blank is graded incorrect and counts against the score, but is not a wrong answer and does not enter the book — there is nothing to review in an answer that was never given. "Answered" means the same thing in both modes and on both sides of the API (`hasAnswer` in `@prepdeck/shared`): any selection for a choice-based question, and a non-whitespace entry for a fill-in, so a box the user typed into and then cleared counts as skipped rather than wrong.

<a id="fr-5-2"></a>

- **FR-5.2 (M):** A user can browse their Wrong Question Book, filter it by exam/category, and launch a practice session scoped to exactly those questions. The practice action always carries the filtered set, so "Practice these N" and the visible cards are the same questions. Tag filtering follows the [shared rules](#tag-filtering-on-the-review-lists).

<a id="fr-5-3"></a>

- **FR-5.3 (S):** A user can mark an individual wrong question as "mastered," removing it from the active Wrong Question Book view (history is retained) until/unless answered incorrectly again.

## Bookmarks

<a id="fr-6-1"></a>

- **FR-6.1 (M):** A user can bookmark/unbookmark any question at any time (during practice, mock review, or browsing).

<a id="fr-6-2"></a>

- **FR-6.2 (M):** A dedicated Bookmarks page lists all bookmarked questions, filterable by exam/category, with the option to launch a practice session scoped to bookmarks. It uses the same filter component and the same [tag rules](#tag-filtering-on-the-review-lists) as the Wrong Question Book, so the two pages behave identically.

### Tag filtering on the review lists

Both lists render the same control ([`TagFilterBar`](../../apps/web/src/components/TagFilterBar.tsx))
over the same rules ([`lib/tagFilter.ts`](../../apps/web/src/lib/tagFilter.ts)),
because a wrong book can carry dozens of tags while a bookmark list carries
three, and the two must still behave the same way.

- **Only tags on the page are offered.** Availability and the per-tag counts are
  derived from the questions currently listed, never from the whole exam
  catalog, so a tag appears and disappears with its questions.
- **Several tags match any of them (OR).** This is the rule the practice pool
  already applies to its own tag filter. Intersecting domain tags would
  usually return nothing.
- **A selected tag that leaves the list stops filtering.** Mastering or
  un-bookmarking the last question behind an active tag retires the tag and the
  filter it was applying, rather than leaving an invisible filter over an empty
  page. It follows that a filtered page is never empty.
- **Collapsed by default.** The bar shows the tags covering most of the list
  and holds the rest behind "Show N more"; past a dozen tags, expanding also
  offers a search field. Expanded, the chip area scrolls rather than pushing
  the questions off screen.
- **A selected tag is always on screen.** Selected chips lead the bar, and
  neither collapsing it nor searching it for a different tag removes them: the
  search narrows the unselected tags only. A filter the user cannot see is one
  they cannot switch off.
- **Filter chips are controls, not metadata.** They are outlined, carry a count
  and a selected tick, and are separated from the solid tag badges printed on
  each question card; a card tag the filter matched carries the accent ring.
- **The list actions follow the filter.** "Practice these N", Review, Remove
  bookmark and Mark mastered all operate on the filtered result set.

Switching between the two pages keeps whatever selection still applies and
drops the rest, since the same component and state serve both.

## Annotations

<a id="fr-8-1"></a>

- **FR-8.1 (M):** While *reviewing* a question (i.e., outside of live, timed practice/mock answering — see FR-3.4), a user can select a span of text within the question stem, an option's text, or the AI explanation, and apply an annotation style: highlight (with a small set of colors), underline, or bold.

<a id="fr-8-2"></a>

- **FR-8.2 (S):** A user can optionally attach a short free-text note to an annotation.

<a id="fr-8-3"></a>

- **FR-8.3 (M):** Annotations are personal (per-user) and never visible to other users, and never rendered during live practice/mock answering — only on the dedicated Review page (FR-8.4), in post-answer review screens, and throughout Learning Mode ([Learning mode](practice-and-learning-modes.md), FR-14.6), since Learning Mode is a read-through/review context by design.

<a id="fr-8-4"></a>

- **FR-8.4 (M):** A dedicated My Annotations page lists annotated questions with the user's marks for review without re-solving. Stem/option marks render, but AI-targeted marks on this list still use placeholder text in `screens/Notes.tsx`; rendering the actual cached AI explanation here remains a gap. This does not mean AI generation is unavailable in Learning/practice review.

<a id="fr-8-5"></a>

- **FR-8.5 (M):** A user can edit or remove an existing annotation.

## Question notes

<a id="fr-11-1"></a>

- **FR-11.1 (M):** A user can add a free-text note to any question, independent of any annotation and not tied to a specific text span.

<a id="fr-11-2"></a>

- **FR-11.2 (M):** When creating or editing a note, its author chooses a visibility setting: `private` (visible only to its author) or `shared` (potentially visible to other users, subject to FR-11.4 and FR-11.5).

<a id="fr-11-3"></a>

- **FR-11.3 (M):** A user can edit or delete their own notes at any time, regardless of visibility.

<a id="fr-11-4"></a>

- **FR-11.4 (M):** Each user has a personal Settings-page toggle, "Show other users' shared notes," defaulting to **on**, that controls whether *other users'* `shared` notes are displayed to them at all. This setting has no effect on the user's own notes — a user always sees all of their own notes (private and shared) regardless of this toggle.

<a id="fr-11-5"></a>

- **FR-11.5 (M):** A `private` note is never visible to anyone other than its author, regardless of any other user's Settings toggle.

<a id="fr-11-6"></a>

- **FR-11.6 (M):** Like annotations (FR-3.4, FR-8.3), notes — a user's own and any shared notes from others currently visible per FR-11.4 — are shown only in review contexts (post-answer review, Wrong Question Book, Bookmarks, question detail view, Learning Mode per FR-14.6, etc.), and are never displayed during live, untimed practice or timed mock-exam answering, so they cannot act as an inadvertent answer hint.

<a id="fr-11-7"></a>

- **FR-11.7 (M):** A `shared` note always displays its author's display name and avatar ([User profiles](authentication-and-users.md)) to any viewer who can see it. Anonymous or attribution-free sharing is **not** supported.

<a id="fr-11-8"></a>

- **FR-11.8 (C):** Admin can delete any `shared` note (light-touch moderation appropriate for a small trusted group); Admin cannot view or moderate `private` notes belonging to other users.
