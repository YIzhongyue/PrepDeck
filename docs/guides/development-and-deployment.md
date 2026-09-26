# Development and deployment

[Documentation index](../README.md)


## First-time local setup

Use Node.js 24 and npm. The default workflow needs no Cloudflare account,
Google OAuth client, Docker, SQLite CLI, MinIO or AI provider key.

```bash
npm ci
npm run dev:setup
npm run dev
```

Setup generates a local session secret in the ignored
`apps/worker/.dev.vars.development`, builds the SPA and prompts, applies the
ordered migrations to local D1, and seeds a local admin, a local user and three
original practice examples. Running setup or seed again preserves existing data.
The checked-in `.dev.vars.example` documents the only required secret;
development flags and binding declarations live in the development Wrangler profile.

Open **http://localhost:8788** and choose **Sign in as local admin** (or user).
The loopback-only helper signs in through the real Worker API, sets the ordinary
session cookie, and redirects to http://localhost:5173. It is a separate Node
development process and is never bundled or deployed with the application.
The accounts are `admin@prepdeck.test` and `user@prepdeck.test`, both with
password `prepdeck-local-only`. They exist only in local D1. Select the
**Local practice examples** exam to exercise single choice, multiple choice and
fill-in-the-blank questions.

`npm run dev` starts the Worker, Vite and sign-in helper together. It exits with
setup instructions if initialization is missing. Ctrl+C stops the processes.
For separate terminals use `npm run dev:worker`, `npm run dev:web` and
`npm run dev:login`. The Worker listens on port 8787, Vite on 5173 and the local
sign-in helper on 8788. Use localhost consistently so the browser sends its cookie.

## Local resources and persistence

Every development binding is explicit: D1, R2, KV, Durable Objects, both native
import rate limits, Analytics Engine and Email. The launcher always supplies
`wrangler dev --local`, which disables remote bindings, and removes Cloudflare
credentials from child process environments. No cloud login is required.

Resource state lives in the ignored repository-root `.local-state/v3/`.
Ordinary restarts retain it. `npm run dev:setup` applies new migrations and
`npm run dev:seed` adds missing sample records. Stop the application before
`npm run dev:reset`: this intentionally removes **all local resource state**
then runs setup again. The session secret is retained. Remove its ignored file
before setup only when a new local secret is wanted (existing sessions expire).

Inspect resources in Wrangler's Local Explorer at
http://localhost:8787/cdn-cgi/local/explorer. To query D1 directly:

```bash
npx wrangler d1 execute prepdeck --config apps/worker/wrangler.toml --env development --local --persist-to .local-state --command "SELECT id, email, role FROM users"
```

The Worker workspace's older `db:migrate:local` command uses Wrangler's default
persistence directory; use `dev:setup` for this workflow so migration and runtime
state always agree. Prefer the full reset over deleting individual resource
subdirectories: image rows and R2 objects, caches, and rate-limit records can refer
to one another.

## Local email and scheduled jobs

Email uses the native simulator (`remote = false`). Nothing is delivered to a
recipient. Open Settings, enable daily email, select a source with questions, and
set the timezone/delivery hour to the current hour. Then run:

```bash
npm run dev:scheduled -- email
npm run dev:scheduled -- cleanup
```

These commands call the loopback scheduled-event endpoint with the correct cron
expression. Email output appears in Wrangler's terminal, with paths to the captured
HTML/text files. Local Explorer also exposes
`/cdn-cgi/local/explorer/api/local/email/sending` for captured outgoing messages.
The application still observes its normal one-delivery-per-day rule. To repeat a
local email after changing its template, delete only the local admin's delivery
claim using local D1, or run a full reset. Cleanup respects the ordinary attachment
grace period; it does not delete newly uploaded images.

[Cloudflare's local email documentation](https://developers.cloudflare.com/email-service/local-development/sending/)
describes the simulator output. Its binary-attachment limitation does not affect
these HTML/text-only review messages.

## Verification

```bash
npm run test:local
npm run test:local:smoke
npm run typecheck
npm test --workspaces --if-present
npm run test:browser
npm run build --workspace apps/web
```

`npm test` only picks up `*.test.mjs`, so the component-level regressions in
`apps/web/scripts/*.browser.mjs` — the exam workspace, the Knowledge Points
editor, question authoring, MCP setup and the Bookmarks/Wrong-book tag filter —
run under `npm run test:browser`
instead. Playwright is a dev dependency; `npx playwright install chromium`
downloads the browser once (install scripts are not run automatically). CI runs
this as its own job, because assertions nothing executes stop being tests.

Stop development servers before the smoke test. It runs setup twice safely,
starts the actual Worker and web server, verifies admin authentication, D1,
R2 upload/read, persisted KV catalog data, the Durable Object, both native import
limits, scheduled cleanup, and a review message captured by the local simulator.
It creates/removes a temporary note and updates/restores local admin email
preferences; it clears that local admin's daily delivery claim for repeatability.
CI runs this against fresh local state and also runs the browser path.

For browser validation, install Playwright's Chromium browser and run
`npm run test:local:smoke -- --browser`. A bundled Playwright
module can instead be passed as a module URL in `PLAYWRIGHT_MODULE`;
`PLAYWRIGHT_CHANNEL=msedge` or `chrome` uses an installed browser. The browser
check signs in through the helper, loads the seeded workspace, reloads, and takes
desktop/mobile screenshots under `.local-state/` with external requests blocked.
It then runs the accessibility scan described below.

### Accessibility scan

[`scripts/axe-scan.mjs`](../../scripts/axe-scan.mjs) runs
[axe-core](https://github.com/dequelabs/axe-core) over the Worker-served build:
the main signed-in screens (Statistics, Practice and Learning setup and a live
question for each, Mock setup, Knowledge Points, Bookmarks, Wrong questions,
Annotations, Settings and Admin) in all five colour schemes, plus the privacy
and terms pages. Any serious or critical WCAG 2.1 A/AA violation fails the
check. To accept one, add it to `KNOWN_EXCEPTIONS` in the script with the reason.
The list is empty today.

To run it against a running `npm run dev`, after `npm run build --workspace apps/web`:

```bash
node scripts/axe-scan.mjs            # exit 1 on violations
node scripts/axe-scan.mjs --report   # list every violation, never fail
AXE_THEMES=clay,dusk node scripts/axe-scan.mjs
```

The scan moves between screens through the app's own navigation rather than
reloading each one, to stay under the Worker's read rate limit (300 requests a
minute, shared by everything on the local machine). If a screen is still
throttled, the scan waits out the window and opens it again rather than scan an
error state.

## Optional remote integrations

Core local workflows never need Google or AI credentials. AI explanations remain
an explicit remote BYOK operation. To test Google intentionally, copy the Wrangler
configuration to an ignored `wrangler.integration.local` file, configure your own
client and callback URL, use a separate local secret file and run Wrangler against
that configuration explicitly. Do not change the default development profile or
its `--local` launcher. For intentional real Email testing, use that separate
profile with a verified sender and `remote = true`, as documented by Cloudflare;
this sends real mail and needs a cloud account. Never reuse production credentials
or production D1/R2/KV identifiers in a development profile.

The production configuration keeps `ENVIRONMENT=production` and
`ENABLE_DEV_PASSWORD_LOGIN=false`; the local helper and seed never change these
production boundaries. Production sign-in uses direct Google OAuth. Access mode
remains an explicit rollback option.

### Before first deploy

For an existing deployment, retain its current production configuration. A new
deployment from the public export must replace the exported placeholders; see
the [private configuration workflow](public-private-sync.md#private-deployment-boundary).

1. Create the D1 database, R2 bucket, and KV namespace in Cloudflare, and
   fill in their ids in `apps/worker/wrangler.toml`.
2. Apply every ordered migration to the intended **remote** database:
   `npm run db:migrate:remote --workspace apps/worker`.
   Local migrations only initialize the simulator; `npm run deploy` does not
   migrate the remote database.
3. In Google Cloud Console, create an OAuth 2.0 **Web application** client
   (APIs & Services → Credentials). Add `https://<your-domain>/api/auth/google/callback`
   as an authorized redirect URI. Put the client ID in `GOOGLE_CLIENT_ID`
   in `wrangler.toml`. From `apps/worker`, run
   `npx wrangler secret put GOOGLE_CLIENT_SECRET` and enter its client secret.
4. From `apps/worker`, run `npx wrangler secret put SESSION_SECRET` and enter
   a unique cryptographically random value (at least 32 random bytes). Generate
   one locally, for example with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   This production secret signs login sessions and email unsubscribe tokens;
   without it, a successful Google callback cannot create a session. Do not
   reuse `.dev.vars.development` or commit the value. Changing it invalidates
   existing sessions and unsubscribe links.
5. Set `APP_BASE_URL` to the deployed origin and `EMAIL_FROM_ADDRESS` to your
   verified sender. Complete Cloudflare Email Sending domain setup before
   enabling daily email. Verify the target account supports the declared
   Analytics Engine, Durable Object, rate-limit and Email bindings. Keep
   `ENVIRONMENT=production` and `ENABLE_DEV_PASSWORD_LOGIN=false`.
6. If Cloudflare Access was previously put in front of this Worker (an
   earlier setup of this project used it), remove or disable that Access
   Application in the Zero Trust dashboard — otherwise Access's own hosted
   login page intercepts every request before it ever reaches this app's
   login screen, and Google OAuth is left unreachable.
7. Seed at least one `admin` row in the remote `users` table so the first sign-in
   has somewhere to land ([FR-1.2](../requirements/authentication-and-users.md#fr-1-2) — normally done via the
   in-app Authorized Users screen, but that screen needs an admin to exist
   first). A Google account that signs in without a matching row lands back
   on the login screen with an "access not authorized" message rather than
   being let in. The exported migrations contain no production users, and
   `dev:seed` only writes to local D1.
8. Run `npm run deploy` from the repository root, then verify health, Google
   sign-in, admin access, data writes and scheduled jobs on the deployed origin.
   A successful `wrangler deploy --dry-run` checks packaging only; it does not
   validate remote resources, account permissions, OAuth or real email delivery.

### Troubleshooting Google sign-in

The application allowlist and Google's OAuth audience are two separate
gates. Adding an address to PrepDeck's `users` table only affects the second
gate, after Google has redirected the browser to `/api/auth/google/callback`.
If the failing Network request is still an `accounts.google.com` URL and the
callback has not been observed, first inspect the browser redirect/network flow.
Production logs are sampled, so missing callback logs alone do not prove that the
request never reached PrepDeck:

1. In Google Cloud Console → Google Auth Platform → **Audience**, make the app
   **External** when users are outside the owning Workspace. While the app is
   in **Testing**, add every invited Google account under **Test users**;
   otherwise publish the app to **Production**.
2. In **Clients**, verify that the configured client is a **Web application**
   and that its authorized redirect URI exactly equals
   `https://<your-domain>/api/auth/google/callback` (scheme, host, path, and
   trailing slash must match). Verify the deployed `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` belong to that same client.
3. For managed Google Workspace accounts, ask the Workspace administrator to
   check third-party app access restrictions. This happens before PrepDeck can
   query D1, so changing the D1 row cannot resolve a Google-hosted error.

Use only one authentication architecture at a time:

- `AUTH_MODE = "cookie"` enables PrepDeck's direct Google OAuth flow. Remove
  any Cloudflare Access Application protecting the same hostname.
- `AUTH_MODE = "access"` disables direct Google sign-in and requires a
  correctly configured Cloudflare Access Application to inject
  `Cf-Access-Jwt-Assertion`. Without that edge configuration, `/api/auth/me`
  correctly returns 401. The `/api/auth/google/start` endpoint returns 503 in
  this mode rather than creating a cookie that Access mode would ignore.

OAuth callbacks now emit structured `auth.google.callback.*` events for
provider errors, missing parameters, state failures, token-exchange failures,
and application authorization failures. The logging calls omit authorization
codes, state and tokens, but some include provider error values/raw exception
messages; see the [logging gaps](../operations/observability-runbook.md#current-gaps).
A lone sampled `auth.google.start` event is not proof that no callback occurred.



## Troubleshooting local startup

- Missing setup or `SESSION_SECRET`: run `npm run dev:setup`; inspect the ignored
  environment-specific secret file if you edited it manually.
- Port already in use: stop the earlier launcher; the local scripts deliberately
  use fixed loopback ports so Vite, sign-in and scheduled helpers cannot drift.
- Login returns 404: the Worker must use the development profile with both
  password-login bindings enabled. Production correctly returns 404.
- Login returns 401: rerun `dev:seed` for missing accounts. It preserves existing
  account changes; use `dev:reset` to restore the documented credentials.
- Missing tables or no sample exam: migration, seed and runtime must use the same
  `.local-state` persistence path. Run `dev:setup` rather than ad-hoc migration
  commands without `--persist-to`.
- Rate limited after repeated manual checks: allow the one-minute local quota
  window to expire. The development profile exercises real limiter behavior.
- Email not captured: check enabled settings, source availability, current local
  delivery hour, and the daily-delivery claim before retrying.
- Optional remote integration fails: keep troubleshooting confined to its explicit
  configuration; the default launcher should remain independent of cloud services.

## Deployment and validation boundaries

The checked-in target is Worker static assets, not a separate Pages deployment.
`npm run deploy` builds the web bundle and deploys the Worker with that bundle.
It does not replace the explicit ordered D1 migration step. Apply all migrations,
including newer MCP/order-scope tables, in the intended environment before checking
features. Verify [scheduled jobs](../operations/scheduled-jobs.md),
[rate limits](../operations/cloudflare-rate-limits.md) and
[logging policy](../operations/observability-runbook.md) separately from build success.

For a local change, follow [contributor validation](../../.github/CONTRIBUTING.md#validate-your-work).
Do not use root `npm run build` as a harmless validation command: the Worker build
hook applies remote D1 migrations when `WORKERS_CI=1` and `WORKERS_CI_BRANCH`
matches the configured production branch (default `master`). The web-only build
avoids that hook.
Cloudflare WAF/DNS/email-domain configuration is external to this repository and
must not be reported as deployed based solely on the checked-in files.
