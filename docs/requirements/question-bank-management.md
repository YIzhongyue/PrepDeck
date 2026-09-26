# Question banks and administration

[Documentation index](../README.md)

Exams and their banks are shared among invited users; authoring is admin-only.
Providers, exam metadata/badges, archived exams, pagination and question search are
implemented. The [authoring guide](../guides/question-bank-authoring.md) owns UI,
API, revision, import-conflict and historical-grading details. The
[import contract](data-model-and-import-format.md#import-contract) owns validation.
Admin MCP reuses these services; it is implemented, not deferred as in older docs.

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Question banks and imports

<a id="fr-2-1"></a>

- **FR-2.1 (M):** Admin can create, rename, and archive an **Exam** (id/slug, display name, description, language).

<a id="fr-2-2"></a>

- **FR-2.2 (M):** Admin can upload a Question Import JSON file for an exam, validate its schema and semantics, inspect duplicates/conflicts, then confirm execution. Differing existing records require resolutions bound to the exact incoming payload, target and revision; an overwrite flag alone is insufficient. Execution persists eligible questions to D1, archives the source JSON in R2 and records import history. Partial batches and archive retention are defined in the [authoring guide](../guides/question-bank-authoring.md).

<a id="fr-2-3"></a>

- **FR-2.3 (M):** Admin can directly create, inspect, edit and delete individual questions, including stem, options, accepted answers, explanation, tags, difficulty and points. The editor is a right-side drawer with Markdown preview, unsaved-change protection and Save & add next. Updates use optimistic revisions and preserve historical grades; see the [authoring guide](../guides/question-bank-authoring.md).

<a id="fr-2-3-1"></a>

- **FR-2.3.1 (M):** Questions have a stable per-exam sequence number. New imported questions follow input order and append after the current maximum; matching re-imports preserve existing positions. Direct authoring also appends; ordinary updates keep the sequence immutable. A sequence number is a stored ordinal, not necessarily a contiguous row index.

<a id="fr-2-4"></a>

- **FR-2.4 (S):** Admin can tag questions with one or more categories/tags to support filtered practice. The question editor searches the global question-bank catalog, accepts new names and shows selected tags as removable chips. Changes follow the normal Save and unsaved-edit behavior; see the [authoring guide](../guides/question-bank-authoring.md) and implementation.

<a id="fr-2-5"></a>

- **FR-2.5 (C):** Admin can view import history (which file, when, by whom, how many questions affected) sourced from the R2-archived files and a lightweight import log table.

## Admin console

<a id="fr-13-1"></a>

- **FR-13.1 (M):** An admin-only navigation entry opens the Admin screen. Current navigation uses internal screen state (also reachable with `?screen=admin`), not a nested `/admin/*` URL router. The old route hierarchy is superseded by the current screen container.

<a id="fr-13-2"></a>

- **FR-13.2 (M):** A non-admin reaching the Admin screen is sent back to the dashboard by the client guard. Every admin API independently returns 403 for a user-role caller. A dedicated not-authorized message on this client redirect is still a UX gap; the API remains the security boundary.

<a id="fr-13-3"></a>

- **FR-13.3 (M):** The console groups Overview, People, Content and MCP tokens. Content contains exam/question authoring and import/history. AI explanation editing/regeneration and shared-note deletion exist in their feature surfaces/APIs; dedicated AI-management and shared-note-moderation console tabs from the original design are not implemented.

<a id="fr-13-4"></a>

- **FR-13.4 (S):** The Admin Overview tab shows a lightweight **overview panel** with at-a-glance counts — total authorized users (by status: invited/active/revoked), total exams, total questions per exam, and total attempts recorded — supporting the "monitor usage" task already listed for Admin in [Roles and scope](overview.md). These figures are read directly from D1 at request time; no new table is required, and this is explicitly a convenience view, not an analytics/reporting feature.

  The console header's status pill reports that same overview request, because
  it runs the console's D1 queries
  ([issue #49](https://github.com/YIzhongyue/PrepDeck/issues/49)): *Checking
  status…* while it loads, *Operational* when it succeeds, *Slow to respond*
  when it takes longer than 3 seconds, and *Status unavailable* (with the error
  in its tooltip and a Retry on the panel) when it fails. It is refreshed each
  time the Overview tab opens. It is not a full health check of every binding.
  Counts are pluralised ("Across 1 exam"), and the section tabs stay on one line
  at phone widths, scrolling sideways when they do not fit.

<a id="fr-13-5"></a>

- **FR-13.5 (C):** **Deferred optional feature.** A same-day Cloudflare quota indicator is not implemented in Admin. A future design must select its measurement source and account-specific limits; the existing overview counts application records only.

<a id="fr-13-6"></a>

- **FR-13.6 (M):** Admin uses the same browser session as other authenticated application screens, with no separate admin login or elevated re-authentication. Admin MCP uses a separately issued Admin bearer credential; browser-session authority does not transfer to MCP.
