# PrepDeck documentation

This directory is the canonical project reference for product behavior, data
contracts, architecture, contributor workflows and operations. Start with the
overview, follow the learning workflow, then read the architecture and setup guide.
Delivery status describes the current checked-in implementation; deployed
account state is verified separately. [Status and future work](requirements/future-enhancements.md)
records the gaps between the original specification, current code and open issues.

## Requirements and product behavior

| Document | Read it for |
| --- | --- |
| [Overview](requirements/overview.md) | Scope, roles, terminology, reading order and acceptance scenarios. |
| [Exam workspaces](requirements/exam-workspaces.md) | Active exam, personal data scope and safe switching. |
| [Authentication and users](requirements/authentication-and-users.md) | Google OAuth, invitations, RBAC and profiles; FR-1, FR-12. |
| [Question-bank management](requirements/question-bank-management.md) | Admin authoring, imports and console boundaries; FR-2, FR-13. |
| [Practice and learning modes](requirements/practice-and-learning-modes.md) | Practice, timed mock exams, Learning and prompt copy; FR-3, FR-4, FR-14. |
| [Review, notes and annotations](requirements/review-notes-and-annotations.md) | Wrong questions, bookmarks, markup and note sharing; FR-5, FR-6, FR-8, FR-11. |
| [Knowledge Points](requirements/knowledge-points.md) | Private concept notes, links, exam-related views and editor gaps; FR-15. |
| [AI explanations](requirements/ai-explanations.md) | BYOK, shared caches, regeneration and key storage; FR-7. |
| [Statistics and progress](requirements/statistics-and-progress.md) | Answer counts, activity and resume semantics; FR-9. |
| [Data model and import format](requirements/data-model-and-import-format.md) | Ownership, canonical migrations/schema, validation and example; FR-10. |
| [Non-functional requirements](requirements/non-functional-requirements.md) | Performance, security, consistency, cost and accessibility targets. |
| [Requirement register](requirements/requirement-register.md) | Every existing FR identifier, priority, delivery status and owning definition. |
| [Future enhancements](requirements/future-enhancements.md) | Delivered work, partial/open plans and intentional deferrals. |

## Architecture

| Document | Read it for |
| --- | --- |
| [System overview](architecture/system-overview.md) | Worker assets, authentication boundaries, services, caches and background jobs. |
| [Component questions](architecture/component-questions.md) | Generic import model, pipeline boundaries and verified limits. |
| [Question prose examples](screenshots/question-prose.md) | Reflowed extraction lines, preserved formatting and annotation-coordinate checks. |
| [MCP](architecture/mcp.md) | Separate audiences, lifecycle, runtime catalogs, proposal/revision contracts and audit. |

## Contributor and operator guides

| Document | Read it for |
| --- | --- |
| [Development and deployment](guides/development-and-deployment.md) | One-command local setup, simulated bindings, auth, scheduled jobs and deployment. |
| [Public/private repository workflow](guides/public-private-sync.md) | History-free export, readiness checks and one-way upstream synchronization. |
| [Question authoring](guides/question-bank-authoring.md) | Drawer workflow, import review, historical grading and content extension. |
| [MCP and Skills](guides/mcp-and-skills.md) | Secure client setup, safe verification and shipped versus planned Skills. |
| [MCP presentation examples](screenshots/mcp-presentation.md) | Synthetic quiz output, table/figure fidelity and text-only fallback verification. |
| [Skill verification](guides/skill-verification.md) | Safe client verification and packaged User/Admin Skill checks. |
| [Knowledge Point editor](guides/knowledge-point-editor.md) | Visual authoring, Markdown fallback and recovery. |
| [Shared UI components](guides/ui-components.md) | Vendored Untitled UI primitives, the design-token mapping behind the five color schemes, and remaining migration scope. |
| [Cloudflare cost containment](operations/cloudflare-cost-containment.md) | Account-specific budget checks, incident controls and automation boundaries. |
| [Rate limits](operations/cloudflare-rate-limits.md) | Edge rules, Worker quotas and failure policies. |
| [MCP metrics](operations/mcp-observability.md) | Privacy-safe counter schema, five-minute queries, volume estimate and rollout checks. |
| [Observability](operations/observability-runbook.md) | Current log/audit inventory, gaps, sampling and retention targets. |
| [Content mutation audit](operations/content-mutation-audit.md) | Actor, entry point, target and outcome across browser, import and MCP writes. |
| [Scheduled jobs](operations/scheduled-jobs.md) | Review email, unsubscribe, image cleanup, the abandoned-practice sweep and operational caveats. |
| [Component question UI](screenshots/component-questions.md) | Synthetic desktop/mobile evidence for component rendering, answering and editing. |
| [Screenshot policy](screenshots/README.md) | Where to add current, sanitized visual evidence. |
| [Login layout](screenshots/login-layout.md) | Desktop/mobile login layout and browser verification. |

Related repository material: [contributing](../.github/CONTRIBUTING.md),
[security](../SECURITY.md), [PDF conversion Skill](../skills/pdf-to-quiz/SKILL.md).

## Maintaining this reference

- Put stable user behavior in `requirements/`, system boundaries/decisions in
  `architecture/`, repeatable workflows in `guides/`, and deployment/incident
  procedures in `operations/`. Put reviewed UI evidence in `screenshots/`.
- Keep one owner for each contract. Link executable schemas, migrations and
  runtime tool registrations instead of duplicating them as authoritative copies.
- Preserve existing FR IDs, link their owning anchors and update the requirement
  register when status changes. Never silently reuse an obsolete identifier.
- Add issue links for new behavior, clearly label proposals/optional work and
  record partial delivery. An open issue can contain already implemented work.
- Link each new document here and back to this index. Use relative Markdown links
  instead of old numeric section references. Update code-comment references too.
- Treat account-side settings and deployment evidence separately from repository
  behavior. Do not turn suggested quotas, tests or plans into claims of deployment.
- Check relative file/heading links and requirement coverage before removing or
  moving a document. Historical prose belongs in Git history, not redirect files.
