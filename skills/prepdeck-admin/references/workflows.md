# Admin workflows

Runtime discovery supplies exact schemas and limits; concrete names here are
mechanically checked against repository registrations. Preview is read-only,
not a saved server draft or permission to change additional targets.

## Inspect and propose

Resolve the requested exam to its ID. Use the available missing-explanation,
duplicate, invalid-answer-reference or metadata QC reads. Follow pagination and
report truncation. Duplicate stem matches are candidates for review, not proof
that either question should be deleted. Show selected IDs and the concrete
proposed changes before any high-impact edit.

## Create or edit questions

1. Fetch existing questions for edits. Preserve fields outside the request and
   retain each `revision` for `expectedRevision`.
2. Call `admin_validate_question_payload` with the exact target/payload. Present
   validation issues, before/after diff and answer-key changes. A valid create
   preview returns `proposalToken` and `proposalId`; preserve both.
3. Obtain explicit approval of the reviewed AI edit/create proposal. Call
   `admin_create_question` or `admin_update_question` with unchanged payload and
   returned bindings. For multiple selected questions, validate each then use
   `admin_batch_create_questions` / `admin_batch_update_questions` within the
   current schema's item cap. Use only the approved IDs; an explicitly selected
   subset is allowed and must never expand the reviewed set.
4. Report created/updated/skipped/failed counts and each failed item's
   `inputIndex`/ID. A successful wrapper does not mean every item succeeded.
5. On stale `proposalToken` or `expectedRevision`, fetch current state, validate
   again, show the revised diff and obtain approval for changed content. Never
   replace the revision and resend the previous edit blindly.

For a partial batch retry, keep the successes and intentional skips. Retry only
unresolved, eligible items from the approved set, using the original create
`proposalId` where replay is supported. Fetch and re-preview conflicted items;
obtain approval for changed proposals before committing them. Read back uncertain
updates first. Preserve a mapping to the original item IDs when retry input
indexes change, and report remaining failures separately.

For an uncertain create response, preserve the original `proposalId`; the server
supports replay of that exact create. Do not generate a new idempotency key to
retry the same creation. Updates lack that create replay contract: read back
first, then decide whether the requested result already exists.

## Imports

Call `admin_validate_import` for schema feedback, then `admin_preview_import`
for current database classification. Validation alone does not detect existing
rows/conflicts. Display create/update/identical-skip/conflict results and the
exact proposed resolutions; ask for approval of the reviewed import.

Execute with `admin_execute_import`, preserving the same file, `importId`,
`importToken`, and approved conflict resolutions. Each resolution binds the
previewed `questionId`, `expectedRevision`, `incomingToken` triple; a broad
"overwrite everything" never authorizes newly changed rows. Do not substitute
`proposalToken` for `importToken`.

After interruption/unknown outcome, use `admin_get_import_status`. Replay only
the exact same import ID, file and resolutions when the current contract allows
it. Reusing an ID with different resolutions is a conflict. A stale file/token
or target requires a fresh preview and review. Report partial outcome counts and
affected IDs; never rerun the entire file with a new ID merely to hide failures.

## Exams and taxonomy

Read current state and show the exact intended create/update/archive or tag
rename/merge. These tools do not all have preview tokens or revisions: do not
invent those parameters. Obtain explicit approval for high-impact scope, such
as archive/merging tags across questions, then call the actual tool schema.
Prefer the available reversible archive operation; do not invent exam deletion.
Question-bank tags are distinct from users' personal Knowledge Point tags.
They are also distinct from review state: whether a question still needs a human
check is the `needsReview` field on the question itself, filterable through
`admin_search_questions`. Never express review state as a tag.

Question deletion uses `expectedRevision` and can be blocked by attempts,
bookmarks, notes or annotations. Report dependencies on conflict; never delete
those references or bypass safeguards to force deletion.
