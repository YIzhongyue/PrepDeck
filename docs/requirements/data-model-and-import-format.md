# Data model and import format

[Documentation index](../README.md)

The ordered [SQL migrations](../../migrations) are the executable schema. Apply
the entire chain; the old illustrative CREATE TABLE appendix omitted production
columns and tables and is intentionally replaced by these sources. Do not edit
already-applied migrations. DTOs and validators live in [shared code](../../packages/shared/src).

## Entity ownership

| Domain | Records and relationships |
| --- | --- |
| Identity | `users` owns role/status/profile/preferences; invitations restrict membership. Provider and exam catalogs are shared. |
| Questions | `questions` belongs to one exam; external IDs identify source rows and sequence numbers order learning. Revisions, import baselines and answer revisions are distinct. |
| Explanations | `ai_explanations` is shared by question/provider/model with requester metadata, never API keys. |
| Answering | `attempts` belongs to user + exam; `attempt_answers` stores selections, correctness and grading snapshots. Mock drafts/flags and completion timestamps support resume. |
| Review | `wrong_question_book`, `bookmarks`, `annotations`, `notes` refer to a user and question. Only notes have optional sharing; annotation ranges have a target type/reference. |
| Resume | `learning_progress` stores user + exam + last sequence number; it is not an attempt. |
| Knowledge Points | Notes, groups, tags, question links, image records and order-scope revisions belong to the user. Exam-related views derive from links rather than duplicating notes. |
| Email | `user_email_settings` and `daily_review_email_deliveries` hold preferences and unique user/local-date claims. |
| MCP | `mcp_credentials` holds digests/lifecycle metadata; Admin audit, create-idempotency and import-job/committed-item tables support safe mutations and retries. |
| Imports | `import_logs` records upload metadata; R2 holds source JSON under bounded retention. |

Dates are not universally one format: MCP credential timestamps use Unix
milliseconds while older tables often use ISO text. Follow each shared DTO and
migration. Historical grading snapshots may be null for legacy answers; never
infer a missing historical key from the current question.

## Import contract

The canonical schema is [import-schema.ts](../../packages/shared/src/import-schema.ts),
with semantic checks in [import-validate.ts](../../packages/shared/src/import-validate.ts).
The [converter reference](../../skills/pdf-to-quiz/references/import-format.md)
explains the offline output contract; [authoring](../guides/question-bank-authoring.md)
defines preview, conflict resolution and commit behavior.

`schemaVersion` is currently `1.0`; `exam.id` and `exam.name` are required.
`source` metadata is optional. Files contain 1–1,000 questions. REST import bodies
are bounded to 5 MiB and 32 nesting levels. Stems are nonblank and at most 20,000
characters; options are at most 20, each text at most 10,000; explanations at most
50,000; tags at most 50, each at most 200. Consult the schema for all constraints.

```json
{
  "schemaVersion": "1.0",
  "exam": { "id": "example-exam", "name": "Example exam", "language": "en" },
  "questions": [{
    "externalId": "q-001",
    "type": "single_choice",
    "stem": "Which value equals **two plus two**?",
    "options": [{ "id": "A", "text": "4" }, { "id": "B", "text": "5" }],
    "correctAnswers": ["A"],
    "explanation": null,
    "difficulty": "easy",
    "tags": ["arithmetic"],
    "points": 1
  }]
}
```

Reject duplicate external IDs within a file, duplicate option IDs, missing answer
references and invalid type-specific option/answer cardinalities. True/false uses
exactly the `true`/`false` options. Fill-blank omits `options`; multiple choice has
at least two accepted option IDs. Existing external-ID conflicts require reviewed
resolutions, not unconditional overwrite. Unknown source fields are not guaranteed
round-trip persistence in normalized question records; raw archived input is not
an extensible database column contract. Preserve meaningful provenance in the
conversion evidence and import archive rather than inventing unsupported fields.

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Question types

<a id="fr-10-1"></a>

- **FR-10.1 (M):** v1 must support: single-choice, multiple-choice, true/false, and fill-in-the-blank questions.

<a id="fr-10-2"></a>

- **FR-10.2 (M):** Fill-in-the-blank grading is case-insensitive, whitespace-trimmed exact match against one or more accepted answer strings defined on the question.

<a id="fr-10-3"></a>

- **FR-10.3 (M):** The data model and import schema must be designed so that new question types (e.g., short-answer with model grading, essay, ordering, matching) can be added later by extending an enumerated `type` field and adding a corresponding renderer/grader, **without** requiring a breaking schema migration for existing questions. See [Import contract](data-model-and-import-format.md#import-contract) and [Future work](future-enhancements.md).
