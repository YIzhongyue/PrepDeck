# Direct question-bank authoring

[Documentation index](../README.md)

Implements the Admin authoring portion of implementation. In **Admin → Content → an exam**,
use **Add question** even when the bank is empty. A right-side drawer provides
editing and Markdown preview. The editor supports single choice,
multiple choice, true/false and fill in the blank, including Markdown stems,
options, official explanations, accepted answers and existing metadata.

**Save** takes effect immediately. **Save & add next** opens an empty question in
the same exam, retains only its type, and focuses the stem. Failed validation or
server requests keep the current input. Dismissal and app/browser navigation
protect unsaved edits. Imported questions use the same editor.

The tag selector (implementation)
searches the existing question-bank catalog. Select a suggestion or choose
**Create** to add a new name. Selected tags appear as rounded chips with remove
buttons available on hover, keyboard focus and touch. Adding or removing a chip
changes the draft; tags are registered and attached only when the question is
saved. A failed suggestion request leaves the question editable and can be retried.
Matching uses the [shared question-tag normalization](../../packages/shared/src/questionTags.ts),
including case-insensitive identity, ASCII whitespace folding and one leading `#`.
The [import limits](../../packages/shared/src/import-validate.ts) also apply here.
See the [desktop and mobile captures](../screenshots/README.md#admin-question-tags)
for the searchable selector and wrapping chips.

Lists have 50-question pages, type/difficulty/tag filters (matched by
normalized identity — trimmed, case-insensitive — against the tag catalog,
not a byte-exact string) and stem search.
The search also matches an exact internal or external ID. Both IDs and the
sequence number are visible. Mutations refresh Admin counts, the selected exam's
practice catalog, learning details and client AI caches.

## Storage and API contract

Apply the entire ordered [migration chain](../../migrations) for the target Worker.
Authoring was introduced by `0015_question_authoring.sql`; that migration is additive, preserves existing IDs and learning records, and
does not guess legacy answer keys or import provenance. It does not require
deduplicating historical external IDs to migrate successfully.

- `POST /api/exams/:examId/questions`: accepts the canonical import question
  fields; returns `{question}` with HTTP 201. IDs are UUIDs. Sequence allocation
  happens inside the insertion SQL, after the exam's current maximum, so
  concurrent direct creation/imports cannot allocate the same new ordinal.
- `PATCH /api/exams/:examId/questions/:id`: requires `expectedRevision` from the
  fetched question. An atomic SQL revision predicate rejects stale writes with
  HTTP 409. Omitted editable fields retain their values. Explicit null clears
  `externalId`, `explanation` or `difficulty`; `[]` clears tags. Switching to
  fill in the blank omits options. Internal ID, exam ID and sequence are immutable.
- `GET /api/admin/question-tags`: returns `{tags: string[]}` from the global
  question-bank catalog, including registered tags with no current question links.
  The route is admin-only and read-only. New tags continue to be resolved or
  created by the existing question save endpoints; no separate creation request
  or migration is needed for the selector.
- External IDs are optional, exact strings, unique within an exam for new or
  changed identities. Null means no external ID. SQLite triggers enforce this
  at the write boundary, including imports. Legacy duplicates remain editable
  but cannot be matched for automatic re-import; correct their IDs first.
- Canonical field validation comes from `validateQuestionRow`; HTTP 422 returns
  `{error, issues: [{path, message}]}`. Duplicate external IDs return HTTP 409
  with an `externalId` field error. Zero points is preserved.
- All question-management and import routes retain `requireAdmin`. Shared
  operations live in `apps/worker/src/lib/questionManagement.ts`; callers must
  establish the authorized administrator context before invoking these helpers.
- Deletion fails with HTTP 409 when learning records or cached explanations
  reference the question. This includes ungraded attempts' question lists.
  No learning records are deleted or cascaded.

## Re-import review

### PDF preparation and component questions

Use the generic [PDF/component workflow](../../skills/pdf-to-quiz/references/component-format.md)
for shared passages, tables, figures, code, combinations, ordering and matching.
Both 1.0 Markdown and 2.0 component imports enter through **Import JSON** and the
same preview/conflict/commit flow. The dialog can preview the first five items;
review the complete source offline before importing. PDF extraction runs locally.

`GET /api/import-schemas`, `user_get_import_schemas` and
`admin_get_import_schemas` expose both canonical schemas and supported components.
Document/provider profiles stay in the offline converter. Users can prepare
files; exam creation and shared-bank writes/exports require an administrator.
Admin MCP uses `admin_preview_import` then `admin_execute_import`.

Structured questions open a JSON editor with a live preview and optimistic
revision checks. Save the component source; changing only its derived flat stem
or options is rejected. **Export this page** downloads a portable 2.0 package;
`GET /api/exams/:examId/questions/export` and `admin_export_questions` expose
paginated export with `nextOffset`. Export shared-material revisions separately
when their IDs conflict. Legacy questions also export as components, preserving
true/false identity. Component annotations and a graphical block editor are
currently unsupported.

### Conflict handling

The JSON file format and PDF conversion workflow remain compatible.
**Import JSON** first validates the file and shows per-field current/incoming
differences for existing matches. Each conflict defaults to **Keep current**;
the administrator can explicitly choose **Apply incoming version**.

The validate endpoint adds `conflicts`, each containing `questionId`,
`externalId`, `expectedRevision`, `incomingToken`, `reason` and `differences`.
The execution body is the import file plus optional `conflictResolutions`:

```json
{
  "questionId": "stable-internal-id",
  "expectedRevision": 3,
  "incomingToken": "sha256-from-preview",
  "action": "apply"
}
```

Each resolution must match the exact target, current revision and canonical
incoming payload. Changed records or payloads require another preview.
`duplicateStrategy=overwrite` alone no longer overwrites differing records.
Identical matches are skipped. Imported records save a canonical baseline;
manual edits preserve it, allowing conflicts to identify local edits. Missing
baselines are reported as unknown provenance and preserved. Ambiguous external
ID matches are always preserved until identities are corrected.

Execution reports `created`, `updated`, `skipped`, `failed`, unresolved conflicts
and per-question `outcomes` (including IDs and reasons). `skipped` includes
conflicts. Legacy ambiguous matches can produce multiple outcomes per source row.
Each batch of up to 50 D1 writes is atomic; different batches may complete
independently. A rolled-back batch reports every item failed. A stale conditional
update reports a conflict. Retry only failed/conflicting records after a new
preview. Repeating an already applied external-ID payload is an identical skip.
As in the existing import contract, records without external IDs are new records
on each import; do not replay successful anonymous rows. The UI disables repeat
submission after receiving results. Existing R2 archives/import logs are retained.

## Answer revisions and caches

Question `revision` is independent of `answerRevision` / `answerRevisedAt`.
The answer revision changes only when grading semantics change: the question
type or normalized accepted-answer set. Choice ordering and fill-answer
case/outer whitespace do not create answer revisions. Explanation, stem, tags,
difficulty and points edits alone do not create answer revisions.

Tags themselves live in a canonical catalog (`question_bank_tags`) with an
ID-based association per question (`question_tag_links`), not a per-question
name array — see [`docs/architecture/mcp.md`](../architecture/mcp.md)'s tag
catalog section. Editing a question's own tags still bumps that question's
`revision` like any other field edit; renaming or merging a tag through
Admin MCP's `admin_update_tag`/`admin_merge_tags` is a pure catalog change
that never touches any question's `revision`, `answerRevision`, or content,
no matter how many questions carry that tag.

Practice and mock grading store the answer revision and exact accepted-answer
snapshot with each attempt answer. Updates never regrade historical answers,
change their correctness or recompute completed attempt scores. Future grading
uses the new key. Learning history and mock results show **Answer revised** with
the timestamp and distinguish the current key from the historical grading key.
Legacy snapshots remain null and the UI explicitly says the original key was
not recorded. Practice feedback also shows revision information.

A database trigger atomically invalidates AI explanations when question type,
stem, options, answers or official explanation changes. AI generation also binds
its cache insert to the question revision it read, preventing a long-running
generation from restoring a stale explanation after an edit.

## Content extension boundary

Existing content remains plain Markdown strings: no destructive content migration
is required. `QuestionContent.tsx` is the question preview/learning/practice/mock
renderer boundary, backed by the same constrained Markdown parser used for AI
explanations. Supported formatting includes headings, lists, emphasis and code;
this is not a full CommonMark implementation. Raw HTML is displayed as text.
Question annotations retain raw source coordinates through a source-offset map;
the existing AI-explanation annotation coordinate system stays unchanged.

For future richer content, add an explicit content format/version with a default
of `markdown-v1` for all existing strings. Adapt richer nodes at `QuestionContent`,
and add typed editor controls alongside the current Markdown fields. Image nodes
should reference validated upload asset IDs; tables should use structured nodes
or an intentionally supported Markdown table grammar. Custom tags must use a
controlled node renderer and tag/attribute allowlist. Never pass authored content
to arbitrary executable HTML. New format migrations must preserve or explicitly
translate annotation coordinates; existing Markdown can remain unchanged.

## Deferred scope

Admin MCP servers, credentials, proposal previews/commits, batch mutations and
mutation auditing are implemented through implementation–implementation. See [MCP architecture](../architecture/mcp.md)
for the distinct proposal/revision/import-job contracts and [connection setup](mcp-and-skills.md).
REST import conflict resolutions and MCP proposal tokens are different contracts;
do not substitute one for the other. Richer versioned content remains a future
extension, not a shipped rendering format.

## Verification

`npm test --workspaces --if-present`, `npm run typecheck`, and
`npm run build --workspace apps/web` cover the normal checks. Worker authoring
tests apply the real migration chain to in-memory SQLite and exercise the actual
Hono routes, including historical grading, authorization and import resolutions.
Frontend tests cover reset state and annotation coordinate compatibility.

The optional browser regression is
`node apps/web/scripts/question-authoring.browser.mjs`. Install Playwright, or set
`PLAYWRIGHT_MODULE` to the module URL of an available installation. Optionally set
`BROWSER_EXECUTABLE` to Chromium/Chrome/Edge and `SCREENSHOT_DIR` for screenshots.
It runs actual authoring components against isolated HTTP fixtures, covering
continuous creation, failed saves, previews, focus, stale edits, unsaved-input
protection, phone layout and pagination beyond 200 questions.
