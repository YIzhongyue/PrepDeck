# Daily review email and image cleanup

[Documentation index](../README.md)

The two schedules in [wrangler.toml](../../apps/worker/wrangler.toml) share
[the scheduled handler](../../apps/worker/src/index.ts). They run independently of
HTTP middleware: changing `CIRCUIT_MODE` does not suspend either job. Include Cron
configuration in a containment/recovery procedure when scheduled work itself is
the source of storage or email usage.

## Daily review email

implementation adds Settings opt-in,
1–5 questions per email, source `wrong` / `bm` / `new`, an IANA timezone and local
delivery hour (0–23). Defaults and validation live in
[settings routes](../../apps/worker/src/routes/dailyEmailSettings.ts) and
[shared settings](../../packages/shared/src/dailyEmailSettings.ts).

Every 15 minutes (`*/15 * * * *`), the job selects enabled settings, checks local
hour and active user status, and claims `(user_id, local_date)` before delivery.
This prevents repeat sends on overlapping runs; it intentionally favors avoiding
duplicates over guaranteed delivery. A failed send or empty selection keeps the
day claimed, so later ticks do not automatically retry it. Selection prefers questions absent from the three most recent delivery rows
(the current empty claim may be among them). If too few fresh candidates remain,
it falls back to the complete eligible pool; repeat avoidance is best-effort,
not a strict three-day exclusion. Selection is account-wide across eligible
exams, independent of the browser's selected exam; email links are navigation
entry points, not stored mock/practice attempts.

The [delivery job](../../apps/worker/src/scheduled/sendDailyReviewEmails.ts) sends
HTML and plain text through [the email binding wrapper](../../apps/worker/src/lib/email.ts).
`APP_BASE_URL` and `EMAIL_FROM_ADDRESS` must match the deployment. The template logo uses the local public asset
`/email/prepdeck-logo.png`, resolved against `APP_BASE_URL`. Do not imply BIMI or mailbox-avatar support from this
in-message image. The sending service/domain configuration is external to Git.

Unsubscribe uses a signed token on `/api/email/unsubscribe`, outside browser
session middleware, so a recipient can opt out without signing in. Treat that URL
as sensitive; never copy tokens into logs. See
[unsubscribe handler](../../apps/worker/src/routes/unsubscribe.ts) and
[token signing](../../apps/worker/src/lib/unsubscribeToken.ts).

For missed delivery, inspect enablement/timezone/hour, active account status,
the day's claim and eligible source questions, then binding/domain configuration.
The presence of a claim does not prove delivery: it is inserted before sending.
Do not delete claims or replay production sends merely to test connectivity.
The current failure logger includes user ID and exception text; handle diagnostics
under the restrictions in [observability](observability-runbook.md).

## Knowledge Point image cleanup

At `17 3 * * *` (03:17 UTC),
[cleanup](../../apps/worker/src/scheduled/cleanupKnowledgePointImages.ts) claims up
to 200 `pending`/`orphaned` images older than the 24-hour grace window. It checks
each note's current saved body for the stable image URL; a referenced image is not
claimed even if its status is stale. One D1 batch inserts deletion tombstones and
removes the live image rows. The job then deletes R2 objects from the bounded
queue, removing a tombstone only after the object deletion succeeds. Failed R2
deletes stay queued for a later tick rather than becoming untracked objects.

Migration `0028_kp_image_deletion_queue.sql` creates the queue and must be applied
before this cleanup version runs. REST content autosaves and their image-status
changes share an atomic revision gate through `applyNoteEdit`, so an older
concurrent save cannot orphan an image referenced by a later successful save.
Attached images and images referenced by the latest saved body are preserved.

Inspect both the live image rows and deletion queue when diagnosing failures.
A queued object is awaiting retry, not a live attachment. Do not remove a queue
entry just to hide an R2 error. The regression tests in
`apps/worker/scripts/knowledge-point-consistency.test.mjs` cover competing REST
saves, preservation of referenced images, and durable retry after an R2 failure.

## Local verification

Run `npm run dev:setup`, then `npm run dev`. Enable local admin email preferences
for the current hour and choose a source containing questions. Use
`npm run dev:scheduled -- email` or `npm run dev:scheduled -- cleanup` to invoke
the real scheduled handler locally. The default launcher supplies `--local`
and the development `EMAIL` binding has `remote=false`: captured messages
appear in Wrangler's terminal and Local Explorer without external delivery.

`npm run test:local:smoke` verifies the real local bindings and captures a review
message through the native simulator. See the
[local development guide](../guides/development-and-deployment.md#local-email-and-scheduled-jobs)
for state inspection, repeatable email tests and explicit remote integrations.
