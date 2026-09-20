# Product scope and reading guide

[Documentation index](../README.md)

PrepDeck is a multi-exam practice platform for a small invited group, originally
sized for at most ten named accounts. Admins manage membership and shared banks;
users practice, take timed mock exams and study questions with personal progress,
review material and optional BYOK explanations. Both roles can learn.

This reference describes the current checked-in implementation, including the
coordinated September 2026 updates. It describes repository
behavior, not proof that every migration, dashboard rule or DNS record is deployed.
Requirements keep their original FR identifiers and M/S/C priorities; see the
[requirement register](requirement-register.md) for ownership and corrected/deferred
items. “Implemented” means present in this code baseline, not issue closure or a
guarantee that every edge case is verified.

## Roles and scope

| Concept | Meaning |
| --- | --- |
| Exam / bank | Shared exam definition and its questions. Providers organize the catalog. |
| Workspace | Active user + selected exam, not a team or tenant. |
| Attempt | Practice or mock session; submitted answers produce grading records. |
| Learning | Sequential read-through review; saves position but creates no answer attempts. |
| Annotation | Private markup on a span of question/option/explanation text. |
| Question note | Whole-question free text, private or explicitly shared with attribution. |
| Knowledge Point | Private concept note with optional links to many questions/exams. |
| BYOK | Provider key supplied transiently for AI generation; explanation cache is shared. |
| MCP | Separate User/Admin capability surfaces in one Worker, authenticated with distinct tokens. |
| Skill | Optional agent instructions: `pdf-to-quiz` converts sources offline; `prepdeck` and `prepdeck-admin` guide their separate MCP audiences. Skills do not grant access. |

Public registration, payments, multi-tenant organizations, native mobile clients,
offline synchronization and social/competitive features remain outside the current
scope. Responsive evergreen-browser use is the primary experience.

## Reading order

Start with [exam workspaces](exam-workspaces.md), then
[authentication](authentication-and-users.md), [question banks](question-bank-management.md),
[learning modes](practice-and-learning-modes.md) and [review](review-notes-and-annotations.md).
Continue with [Knowledge Points](knowledge-points.md), [AI](ai-explanations.md),
[statistics](statistics-and-progress.md), [data contracts](data-model-and-import-format.md)
and [architecture](../architecture/system-overview.md). Consult
[future enhancements](future-enhancements.md) before implementing an open issue.

## Acceptance scenarios

1. Invite two Google accounts with different roles. Unknown/revoked accounts
   cannot access data; a user cannot call admin APIs. Verify browser-cache
   revocation behavior separately from MCP's per-request D1 authorization.
2. Admin creates/imports a bank with valid schema, reviews conflicts and edits a
   question. Past answer grades stay unchanged; future grading uses the new key.
3. Each user runs practice and timed mock sessions in two exams. Answers, wrong
   questions, bookmarks, counts and resume state remain scoped correctly.
4. Generate an explanation with a loaded key, then read that cached model entry
   from another account without a key. No provider key enters persisted storage.
5. Review annotations/notes appear after answering and throughout Learning,
   never as hints during unanswered practice/mock. Private content remains private;
   shared notes obey the viewer toggle and show author identity.
6. Edit profile, Knowledge Points, links and attachments; exercise failed autosave
   and revision conflicts without discarding drafts. Learning opens a linked
   question without creating an attempt and resumes from the saved position.
7. Verify MCP audience isolation and current tool discovery using harmless reads;
   exercise email opt-in/unsubscribe and daily claims in isolated fixtures.

These scenarios preserve the original high-level acceptance intent. Use focused
regressions and [contributor validation](../../.github/CONTRIBUTING.md#validate-your-work)
for a particular change; remaining gaps are explicitly listed in their owner docs.
