# Knowledge Points

[Documentation index](../README.md)

Knowledge Points are private concept-level Markdown notes, independent of
whole-question notes and span annotations. They support flat groups, overlapping
tags, custom ordering, private images and cross-exam question links. See
[web store](../../apps/web/src/store/useKnowledgePoints.ts) and
[Worker routes](../../apps/worker/src/routes/knowledgePoints.ts).

implementation is implemented: **All personal
knowledge points** preserves unlinked and cross-exam notes; **Related to this exam**
filters by linked questions. It neither assigns ownership to an exam nor duplicates
content. Group/tag counts remain library-wide. Reordering is disabled in the
exam-related view and other filtered lists; custom order is defined for the full
group/Ungrouped scope. MCP reorder operations use an order revision in addition
to note revisions.

implementation and
implementation use a visual contenteditable
editor with Markdown storage, editable source fallbacks, inline screenshots,
visual table controls and local Mermaid previews. See the
[editor guide](../guides/knowledge-point-editor.md) for editing, recovery and
repeatable browser checks. Existing question notes remain a separate feature.

Image cleanup runs daily for pending/orphaned uploads older than 24 hours, at most
200 candidates per run. The cleanup claim and body/reference reconciliation share
D1's atomic write boundary. A deletion queue retries failed R2 removal after the
claim; images still referenced by a saved note are retained. Once an expired,
unreferenced image has been claimed, its old URL cannot restore the attachment;
upload it again. See [scheduled jobs](../operations/scheduled-jobs.md).

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Knowledge Points

<a id="fr-15-1"></a>

- **FR-15.1 (M):** A dedicated, nav-accessible Knowledge Points page lets a user create, view, edit, and delete their own notes. A note requires a non-blank title but may have an empty body, no group, no tags, and no linked questions; creation/last-updated timestamps are shown.

<a id="fr-15-2"></a>

- **FR-15.2 (M):** The primary editor is a contenteditable visual editor with headings, emphasis, links, lists, quotes, code, tables and inline images. Markdown typing shortcuts and explicit Markdown/plain-text paste are supported. Table cells, rows and columns, code languages, Mermaid source and image alt text are editable without whole-document source editing. Optional Markdown source and reading-preview modes remain available. Autosave does not replace the editor document or reset undo history; composition input is saved after completion.

<a id="fr-15-3"></a>

- **FR-15.3 (M):** Users can paste a screenshot from the clipboard or upload an image file into the body; images are stored in R2, referenced by a stable Markdown image URL, and are private — retrieval, upload, and deletion all enforce ownership server-side.

<a id="fr-15-4"></a>

- **FR-15.4 (M):** Fenced ` ```mermaid ` blocks render as diagrams (flowchart and other Mermaid syntaxes) using restrictive settings (no embedded script/click-handler execution) and per-diagram error isolation — an invalid diagram shows its source and an error message without blocking the rest of the note from rendering.

<a id="fr-15-5"></a>

- **FR-15.5 (S):** Unsupported Markdown, including block/inline raw HTML, footnotes, reference definitions and extension syntax, is preserved in labeled editable source blocks. Reference-style documents stay together to retain their definitions. Preview displays raw HTML as escaped text and never executes it. Supported Markdown round-trips semantically; whitespace may normalize.

<a id="fr-15-6"></a>

- **FR-15.6 (M):** Edits debounce into an autosave request (~1s of inactivity) showing accessible Unsaved/Saving/Saved/Save-failed status with the last-saved time. Content and metadata writes share a serialized queue, navigation flushes it, and Saved waits for referenced uploads; transient failures retry with bounded backoff and preserve the editor's content. Validation and session failures require correction or explicit retry; a rejected metadata change can be discarded without discarding text. Blank titles remain pending. An opaque revision token detects a save from another tab/device since the editor loaded and offers an explicit reload-latest-or-keep-mine choice rather than silently overwriting either version (real-time collaborative merging is out of scope).

<a id="fr-15-7"></a>

- **FR-15.7 (M):** Notes belong to at most one flat, user-owned **group** (create/rename/delete), plus built-in **All notes** and **Ungrouped** views with per-group note counts. Deleting a group moves its notes to Ungrouped, preserving their content, tags, and links.

<a id="fr-15-8"></a>

- **FR-15.8 (M):** Notes carry any number of user-owned **tags**, overlapping freely across notes, with inline autocomplete-or-create while typing. Tag names are case-insensitively de-duplicated; renaming a tag updates every note that uses it, and deleting one removes only the association.

<a id="fr-15-9"></a>

- **FR-15.9 (M):** Within an unfiltered group/Ungrouped view, notes can be manually reordered (pointer/touch drag, keyboard grip controls and explicit move-up/move-down buttons) into a **Custom order**, persisted server-side per group and used as that group/Ungrouped view's default sort; search/tag filters and exam-scoped views disable reordering while active. An order revision rejects concurrent changes instead of overwriting them. Reordering waits until the complete group has been loaded; failed moves retain the prior order and conflicts reload the latest sequence.

<a id="fr-15-10"></a>

- **FR-15.10 (M):** Notes can be searched by title/body text and filtered by group and tags (multiple tags match all-selected, not any), independent of and combinable with the four sort modes (Last updated, Title, Created, Custom order).

<a id="fr-15-11"></a>

- **FR-15.11 (M):** A note can link any number of questions, searchable by id or stem text across every exam, without exposing the answer key in the search results; duplicate links are prevented and a question may be linked from multiple notes.

<a id="fr-15-12"></a>

- **FR-15.12 (M):** Opening a linked question from a Knowledge Point note navigates to Learning Mode ([related specification](practice-and-learning-modes.md)) positioned on that exact question, for pure review — consistent with FR-14.7, no `attempt` is created.

<a id="fr-15-13"></a>

- **FR-15.13 (M):** Learning Mode, graded Practice review and Mock results ([related specification](practice-and-learning-modes.md)) show the current question's related Knowledge Points, if any, with actions to link an existing note or create a new note with the current question preselected — the inverse direction of FR-15.12.

<a id="fr-15-14"></a>

- **FR-15.14 (M):** Knowledge Points, their groups, and their tags are private to their owner in v1 — enforced on every read/write, independent of the existing shared-Notes visibility setting (FR-11.4), including against direct API access.

<a id="fr-15-15"></a>

- **FR-15.15 (C):** A scheduled background sweep (Cloudflare Cron Trigger) removes image uploads that were never attached to a saved note (or were later un-referenced) after a grace period, so abandoned drafts don't accumulate in R2 indefinitely; an image still referenced by a saved note must be retained. The cleanup claim is atomic with attachment reference writes, and an R2 deletion queue retries object-store failures. An already-claimed expired image must be uploaded again rather than restored by its old URL.
