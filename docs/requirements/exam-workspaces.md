# Exam workspaces

[Documentation index](../README.md)

The active study context is the signed-in user and selected exam. Each exam
keeps one shared question bank; attempts, bookmarks, wrong questions and
learning progress remain personal. No workspace table or data migration is
needed.

Selecting an exam in the sidebar or mobile header preserves the current page.
Selecting the already-active exam does nothing. The last exam is remembered
per account in this browser. An unavailable remembered exam falls back to an
available exam with a notice. No available exams, loading failures, and empty
question banks have distinct states; answering cannot start from an unready
catalog.

Bookmarks, wrong-book entries, counts, bulk-practice inputs, statistics,
annotations and question notes use the active exam. The annotation and note
list APIs accept `examId`; omitting it retains their account-wide API contract.
Private/shared note visibility rules still apply within the requested exam.

Knowledge Points are a personal library across exams, including notes with no
linked questions. They now also offer **Related to this exam** (implementation), filtering
by linked questions without duplicating or reassigning notes. The All personal
view preserves access to unlinked notes. Group/tag counts remain library-wide and
manual reordering is disabled in the exam-related view. Switching exams refreshes
that filtered view while preserving the library/editor and save protections.
See [Knowledge Points](knowledge-points.md) for the full contract. Settings and
Admin remain account-level surfaces.

## Switching with work in progress

Ordinary browsing switches directly. Practice or Mock sessions require a
confirmation before changing study context. Practice saves selected answers
and completes the attempt. Mock saves drafts and flags, retaining a resumable
attempt; its countdown is based on the original start time and continues while
another exam is selected. Cancelling leaves the current context unchanged.

Question-note edits and Knowledge Point uploads/autosaves finish before
navigation. A failed save or unresolved Knowledge Point revision conflict keeps
the editor and its draft mounted and reports the failure. Resolve the conflict
or retry saving/switching to continue. Admin editors retain their existing
unsaved-change guard.

Each exam visit has a new request generation, including A → B → A. Reads and
callbacks from an earlier generation cannot update the new visit. Repeated
reads of the same resource also reject older responses. Writes to a mock
attempt are serialized so a late draft cannot replace a newer one in storage.
Switching waits for pending writes; cancelling a browser wait never claims to
undo a server write.

## Validation

- `npm test --workspaces --if-present` includes SQLite route regressions for
  two users and two exams, review-list filtering, and request-generation/write
  ordering tests.
- `npm run typecheck` checks all workspaces.
- `npm run build --workspace apps/web` builds the Web application without
  invoking remote migrations.
- `node apps/web/scripts/exam-workspace.browser.mjs` runs the real app shell
  against an isolated API fixture. It requires Playwright and a Chromium
  browser. `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` may point to existing
  local installations. It covers rapid switching, stale reads/start responses,
  persistence, failed saves, mock resume, invalid links, responsive selectors,
  and Knowledge Point upload/save protection. It never calls production APIs.
