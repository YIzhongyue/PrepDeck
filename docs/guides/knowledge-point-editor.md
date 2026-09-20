# Writing and reviewing Knowledge Points

[Documentation index](../README.md) · [Requirements](../requirements/knowledge-points.md)

Knowledge Points are private concept notes across your exams. They complement
question-specific notes and annotations; they do not change attempts or scores.
Choose **New knowledge point** to create one stable note, then edit its title and
body. Opening an existing note does not write or normalize it.

## Write visually

**Write** is a visual editor. Use the toolbar or Markdown typing shortcuts for
headings, emphasis, lists, quotes and code. Pasted text is inserted straight
away, interpreted as Markdown; a banner then offers **Paste as plain text
instead** for a literal example. The banner is an alternative, not a gate — it
withdraws itself on the next edit, and the pasted content stays either way. The
optional **Markdown source** view edits the stored representation.

Click in a table to add or remove rows and columns. Edit cells directly. A code
block has a language field and an editable body; a Mermaid block adds a preview
button. Diagram source stays editable after a syntax error. Rendering is local,
uses Mermaid's strict security mode, and is bounded to 12,000 source characters,
250 lines and 150 edges. Larger diagrams should be split into smaller blocks.
The enlarged view contains wide diagrams without widening the page.

Paste an image or use **Image** to upload PNG, JPEG or WebP files up to 8 MB. The
upload placeholder stays at its document position while you write. A completed
upload becomes an inline image with editable alt text and a larger view. Failed
uploads retain your text and offer Retry or Dismiss. Attachment URLs remain
private and stable; they are not expiring download links.
Finish or dismiss an upload before changing editor mode, so its insertion point
stays associated with the current visual document.

Unsupported constructs appear as **Unsupported Markdown — editable source**.
Raw block and inline HTML are never executed. Footnotes, task-list extensions,
reference definitions and other unsupported syntax retain their source; a
reference-style document remains one source block so its definitions stay
connected. Editing other supported blocks does not erase these sections.
Markdown whitespace may normalize, while table structure, code language/content,
image references and Mermaid source are retained.

Undo and redo use the editor's document history. Autosave acknowledgements do
not replace the document, move the selection or reset that history. Chinese and
Japanese composition stays local until the composition is committed.

## Save and recover

Content saves after about one second without editing. Group, tag and question
link changes share the same serialized save queue. **Saved** means the latest
content and metadata have been acknowledged and uploads have completed.

- A blank title remains pending until you supply a title.
- Transient network/server errors retain your text and retry up to five times
  with backoff. **Retry now** starts an explicit retry.
- Validation or session errors require correction or retry after signing in.
  **Discard failed metadata change** removes a rejected tag/group/link operation
  while retaining the title and body.
- A revision conflict keeps local text. Choose **Keep mine** to save against the
  latest revision or **Reload latest** to discard your local content.
- In-app navigation flushes pending work and stays in the editor if it cannot
  finish. Closing or reloading the browser warns about unsynchronized work.

Repeated content-save attempts update the same note ID. Notes are created by
the explicit New action; merely viewing a list or an existing editor creates
nothing. Uploaded images are associated with that stable ID even before the
first body save. Pending/orphaned images become eligible for cleanup after
24 hours. Saved references protect them. Once cleanup claims an expired image,
upload it again; putting its old URL back into Markdown cannot restore it.

Deleting an image, deleting a note, and the expiry sweep all retire attachments
the same way: the database row is dropped and a deletion record is written in
one transaction, then the object is removed from storage. If that last step
fails, the record is what makes the next sweep retry it, so a failure cannot
leave an object behind that nothing remembers. An object whose removal keeps
failing is set aside after several attempts rather than holding up the ones
queued behind it.

## Organize and review

Choose a group or **Ungrouped**, then **Custom order**. Drag the grip, focus it
and press Space followed by arrow keys, or use the up/down buttons. The buttons
also support touch. Sorting by title/date does not change custom order. Search,
tag filters and **Related to this exam** disable reordering. Load all pages in a
group before arranging its complete sequence.

A move is applied on screen immediately and saved in the background. Order
saves use the scope's revision: if another tab changed that order, the move is
rejected, the card returns to where it was, and the latest list is loaded.
Retry the intended move from that list. Previous/Next in the editor follows the same custom sequence.

Link questions across accessible exams. **Open** goes to the exact question in
Learning without starting an attempt. Learning, graded Practice review and Mock
results offer related notes, link-existing and new-note actions. Live Practice
and Mock answering do not display note hints. Question-note drafts are saved to
their original question before Next/Back; failures keep you on that question.

## Validate changes

Use Node.js 24 and install from the repository root with `npm ci`:

```sh
npm test --workspace apps/web
npm test --workspace apps/worker
npm run typecheck
npm run build --workspace apps/web
```

The optional browser suite uses Playwright and an isolated HTTP fixture with
synthetic notes. It renders the actual React providers, screens and editor; it
does not need credentials or connect to a real database:

```sh
# Install Playwright in a separate tooling directory, or use an existing runtime.
# PLAYWRIGHT_MODULE can point to its playwright/index.mjs file.
# PLAYWRIGHT_CHANNEL=chrome uses an installed Chrome; otherwise install Chromium.
node apps/web/scripts/knowledge-points.browser.mjs
```

Set `KP_SCREENSHOTS` to an output directory to capture sanitized editor/library
evidence. The suite covers supported Markdown round-trips, inline-HTML fallback,
visual tables and images, code/Mermaid, native Chromium composition, undo/redo
after autosave, validation/retry/conflicts, slow and metadata saves, uploads,
first-save identity, explicit Markdown/plain paste, invalid/oversized diagrams,
order failure/concurrency, touch ordering, review boundaries, question-note
ownership, all five themes and 375px/desktop layout. Mobile assertions include
page width, vertical clipping of the editor, and dialog focus/escape behavior.
Mock results also verify that New mock returns to setup while ordinary navigation
back to an active mock resumes the same attempt.

The Worker consistency suite exercises REST revision conflicts and ordering
against SQLite, plus cleanup/reattachment and R2 deletion retries. The existing
Knowledge Point MCP suites cover ownership, relationship and organization
behavior using the shared mutation functions. Browser fixtures supplement
these database tests; they do not replace them.

### Browser evidence

The following captures use synthetic notes and an illustrative policy image in
the isolated browser fixture. The small fixture navigation is test scaffolding.
They were checked at 375 px mobile width and 1280 px desktop width:

- [Light, desktop](../screenshots/kp-editor-light-1280.png)
- [Light, mobile](../screenshots/kp-editor-light-375.png)
- [Cream, mobile](../screenshots/kp-editor-cream-375.png)
- [Sage, mobile](../screenshots/kp-editor-sage-375.png)
- [Clay, mobile](../screenshots/kp-editor-clay-375.png)
- [Dusk, mobile](../screenshots/kp-editor-dusk-375.png)
- [Library and ordering, mobile](../screenshots/kp-library-mobile.png)
