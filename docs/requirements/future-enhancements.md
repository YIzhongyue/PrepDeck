# Delivery status and future enhancements

[Documentation index](../README.md)

This is the implementation review for the coordinated September 2026 changes,
not a release schedule or deployment record. Issue checkboxes and open/closed status are supporting evidence; code
and configuration determine what this branch actually contains. Re-check the
linked issues when starting work. See the [requirement register](requirement-register.md)
for original priorities, which must not be read as implementation status.

## Implemented since the original specification

| Work | Current code and documentation |
| --- | --- |
| implementation Learning prompt copy | Implemented; [learning modes](practice-and-learning-modes.md) defines included/excluded content. |
| implementation Daily email | Implemented preferences, selection, daily claim, send and unsubscribe; [scheduled jobs](../operations/scheduled-jobs.md) records delivery limitations. |
| implementation Annotation filters and aliases | Implemented; [review](review-notes-and-annotations.md). |
| implementation Direct authoring | UI/API authoring, revisions and conflict-aware imports exist; [authoring guide](../guides/question-bank-authoring.md). Browser, import and MCP mutations share the reviewed [audit model](../operations/content-mutation-audit.md). |
| implementation, implementation MCP foundation/tokens | Implemented independent audiences, token lifecycle and Settings/Admin controls. |
| implementation, implementation User MCP | Learning/history/discovery and private Knowledge Point tools exist. |
| implementation, implementation, implementation Admin MCP | Read/QC, revision/proposal-bound question mutations, import, exam and taxonomy tools exist; [MCP architecture](../architecture/mcp.md). |
| implementation MCP hardening | Configurable quotas, normalized errors, content-minimized audit and smoke/security tests exist. Bounded Analytics Engine metrics are implemented; physical Worker separation remains an optional deployment decision. |
| implementation Exam workspaces | Implemented user/exam scoping, selection persistence, switching and stale-response protection; [workspaces](exam-workspaces.md). |
| implementation, implementation Layout and KP scope | Learning responsive changes and Related to this exam Knowledge Point filtering exist. |
| Admin drawer and loading refinements | Master includes implementation, implementation, implementation. Authoring uses a drawer; old screenshots are not current UI evidence. |

The implementation MCP parent remains open
although its listed business capability children are present. Do not describe
MCP as identity-only or all mutation work as deferred.

## Recent delivery and remaining operator work

| Issue / plan | Present boundary | Next documentation owner |
| --- | --- | --- |
| implementation, implementation Knowledge Points | Visual Markdown editing, source fallback, image/table controls, private uploads and Learning links are implemented. Autosave image status is revision-gated and cleanup uses a retryable deletion queue. | [Editor guide](../guides/knowledge-point-editor.md), [Knowledge Points](knowledge-points.md) and [scheduled jobs](../operations/scheduled-jobs.md). |
| implementation Self-contained local development | One-command setup/start, deterministic admin/user seed and explicit native local bindings are implemented. Real Worker/browser smoke covers login, storage, limiters and simulated email without cloud credentials. | [Development guide](../guides/development-and-deployment.md). |
| implementation Copy MCP setup prompt | Separate User/Admin setup prompts and safe discovery checks are implemented. Prompts contain no token value and preserve audience separation. | [MCP and Skills](../guides/mcp-and-skills.md). |
| implementation, implementation, implementation MCP-backed Skills | Separate `prepdeck` and `prepdeck-admin` packages are implemented alongside `pdf-to-quiz`; they discover current capabilities instead of freezing tool lists. | [User Skill](../../skills/prepdeck/SKILL.md), [Admin Skill](../../skills/prepdeck-admin/SKILL.md). |
| implementation, implementation, implementation Setup, packaging and docs | Host-owned credential guidance, safe verification, package/secret validation and catalog-drift checks are implemented. Client-specific support and verification limits are recorded. | [Skill verification](../guides/skill-verification.md), [MCP and Skills](../guides/mcp-and-skills.md). |
| implementation Searchable question tags | Admin tag editing uses searchable create-or-select chips with keyboard/touch behavior and the existing normalization/save guards. | [Question authoring](../guides/question-bank-authoring.md). |
| implementation Public repository preparation | Sanitized history-free export, scanner, binary-asset review gate and one-way synchronization helper are implemented. This repository is now the private downstream and its documentation links address it directly; the separate public destination exists but is empty. Asset/readiness review, the reviewed snapshot, its publication and the initial unrelated-history merge remain explicit operator steps; no public repository has been published by these tools. | [Public/private workflow](../guides/public-private-sync.md). |
| implementation Shared UI components | Untitled UI React source is vendored under `apps/web/src/components/base`, bound to PrepDeck's design tokens so imported components follow all five color schemes, and Settings is migrated onto it. Every other screen still uses PrepDeck's own controls; the guide lists the remaining scope and the Clay accent-ramp gap it exposed. | [Shared UI components](../guides/ui-components.md). |
| implementation BIMI | Issue is closed, but this master tree has no BIMI asset or deployment record. DNS/mail-client behavior cannot be inferred from Git; treat branding as external deployment work requiring its own evidence. | Future operations branding record, separate from the daily email implementation. |

This structure leaves room for richer exam content and provider/model migrations,
but does not promote local exploratory drafts into approved requirements. A richer
exam design must cover source provenance, diagrams/tables, question-set structure,
grading and backward-compatible annotations/imports. A model migration must test
request/response compatibility, output limits and cache semantics; typing a custom
model identifier is not evidence that it works. Record the agreed scope in an issue
and a focused architecture/proposal document before calling either implemented.

## Remaining original requirements and decisions

- **Optional, not implemented:** FR-1.8 Access policy synchronization and FR-13.5
  quota indicator. No data deletion/export, source-PDF archive or curated official
  mock-paper workflow is promised by the current implementation.
- **Partial UI/API coverage:** FR-3.1 question-type filter and FR-4.2 optional mock-filter controls; FR-13.2 explicit
  unauthorized-navigation message; FR-13.3 dedicated AI/moderation console tabs;
  FR-8.4 actual cached AI text on the dedicated annotation list (it still renders
  a placeholder there, although Learning/review generation is implemented). Preserve their intent until
  a product decision changes it.
- **Resolved old questions:** direct Google OAuth is default; the shared BYOK
  cache is intentional; curated models plus custom identifiers exist; questions
  use legacy Markdown or versioned components (including ordering and matching); avatar formats/size and AI request/rate guards are
  implemented. These no longer belong in an unanswered decision list.
- **Still optional future scope:** richer types (essay and
  AI-assisted free response), spaced repetition, opted-in team statistics,
  multilingual UI, native apps and registration beyond invitations. Knowledge
  Point collaboration, nested groups, file import/export, version history, offline
  sync and real-time conflict merging remain outside current scope.

The dated legacy Cloudflare quota table, incomplete SQL sketch and stale UI
screenshots are intentionally removed, with code, account-specific operational
checks and current documentation as their replacements. Historical versions stay
in Git; no compatibility RSD or redirect file is required.
