# Personal Knowledge Point capacity

Migration 0047 enforces each account's 10,000 current notes and 100 MiB of
persisted Markdown body text, measured by SQLite UTF-8 BLOB length. Titles and
derived excerpts are excluded. The current model has no soft-delete/history;
their accounting must be decided if introduced. Shared question notes and the
admin question bank are separate. MiB means 1,048,576 bytes.

Existing excess data is backfilled without deletion. Reads, export, deletion,
and non-growing body edits remain available. Atomic triggers cover REST and
MCP transaction paths; quota failures roll back related metadata changes.

Images have independent limits of 5,000 objects and 500 MiB. A durable
reservation is charged before R2 PUT, including unreferenced images. Existing
single-image size and image-validation limits still apply. Deleting a live
attachment only queues retirement: quota is freed after confirmed R2 deletion
and durable ledger removal. Retries cannot decrement usage twice.

## Required review before any deployment

Old `knowledge_point_image_deletions` rows contain no owner or byte size.
Migration cannot safely reconstruct those values or identify pre-existing R2
objects that have no database record. Reconcile these legacy objects with
authorized R2 inventory and confirmed deletion/ownership before claiming full
historical image accounting. Do not infer an owner or size from an unverified
key. This task does not perform that production inventory or deploy migration.

Upload clients send `Idempotency-Key`; the server binds it to the account, target note, content type and SHA-256 content digest. Repeating a completed request returns its original attachment. A key with changed content is refused; repeating an ambiguous upload returns `upload_pending` without sending another PUT or creating another reservation. The web client preserves the key for retries of the same Blob and target note during that page lifetime. Legacy clients without a key retain one-request upload behavior and must opt in for retry deduplication.

An `uploading` reservation deliberately remains charged after an interrupted
PUT or an ambiguous provider failure. Do not expire or delete it on a timer:
a late PUT could otherwise escape accounting. Recovery requires confirming
the original upload is no longer in flight, then verifying/deleting its R2
object before retiring the reservation. No automated reconciliation of these
ambiguous uploads is provided. A completed PUT followed by an uncertain attachment response also remains charged for reconciliation. A read confirming the attachment returns success; an empty read cannot prove that a delayed batch will not commit, so it never triggers automatic object deletion. This is conservative accounting, not a claim
of an atomic transaction across D1 and R2.

Usage notices refresh on saved changes, list counts, uploads and window focus.
They warn at 90% of a dimension; the server remains authoritative. Cloudflare
Paid does not imply zero extra costs: aggregate accounts and retained objects
still require capacity and billing monitoring.
