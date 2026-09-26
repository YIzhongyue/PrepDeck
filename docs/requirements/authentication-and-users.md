# Authentication and users

[Documentation index](../README.md)

Browser authentication, allow-list membership and roles are separate concerns. The
current implementation is [auth routes](../../apps/worker/src/routes/auth.ts),
[authorization middleware](../../apps/worker/src/middleware/access.ts) and
[user cache](../../apps/worker/src/lib/userCache.ts). Setup belongs in
[development and deployment](../guides/development-and-deployment.md).

Production does not support password sign-in. The local password endpoint requires
both `ENVIRONMENT=development` and `ENABLE_DEV_PASSWORD_LOGIN=true`; merely running
Wrangler's development environment does not enable it. MCP credentials and browser
sessions have separate lifecycles; see [MCP setup](../guides/mcp-and-skills.md).

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## Authentication and authorization

<a id="fr-1-1"></a>

- **FR-1.1 (M):** Google sign-in uses the application login screen and direct OAuth, establishing a signed session cookie (`AUTH_MODE=cookie`). The invited-user allow-list protects application data. Static assets, login, health and unsubscribe have public entry points. The old requirement to put every route behind Cloudflare Access is superseded; `AUTH_MODE=access` is an optional rollback path, not the default.

<a id="fr-1-2"></a>

- **FR-1.2 (M):** From a dedicated **Authorized Users** admin screen, Admin can **invite** a new account by entering its Google email address and choosing an initial role (`admin` or `user`). This creates a `users` row with status `invited` and no `google_sub` yet, since the person has not signed in.

<a id="fr-1-3"></a>

- **FR-1.3 (M):** The Worker authorizes the verified Google identity against `users` (resolved per FR-1.9). An invited account becomes active on first sign-in and receives its Google subject/profile defaults; an active account may proceed; an unknown or revoked account is denied. Google authentication alone does not grant membership.

<a id="fr-1-4"></a>

- **FR-1.4 (M):** Admin can change roles or revoke accounts. Browser authorization caches are explicitly invalidated after these changes, but the 600-second KV cache and its propagation mean next-request revocation is not a global consistency guarantee. MCP independently checks current account status/role in D1 on every request. This corrects the original unconditional next-request promise.

<a id="fr-1-5"></a>

- **FR-1.5 (M):** Revoking an account does not delete its historical data (attempts, bookmarks, annotations, etc.) — it only blocks further access. A separate, explicit "delete account and all data" action is a distinct, more destructive operation (Could-have, [Future work](future-enhancements.md)).

<a id="fr-1-6"></a>

- **FR-1.6 (M):** Every protected browser API request verifies the configured cookie session or Access JWT and resolves internal identity, role and status server-side; client-supplied roles are never trusted. Public entry points have their own validation. MCP has separate bearer authentication and cannot use browser cookies or Access JWTs; see [MCP architecture](../architecture/mcp.md).

  Session lifecycle, cookie mode ([issue #46](https://github.com/YIzhongyue/PrepDeck/issues/46)):
  a session is a signed token valid for 7 days that carries its account's
  session version (`users.session_version`, migration `0037`). **Sign out ends
  every session of the account**, on every device and browser: it increments the
  version, and a token with an older version is refused with 401. Revoking an
  account increments it too. Only a still-current token can sign an account out,
  so an old copied token cannot be used to end someone's sessions. The refusal is
  immediate where the request lands and follows elsewhere within about a minute,
  the time a KV deletion of the cached user row takes to propagate. Tokens issued
  before the version existed are refused, so every user signs in once after the
  upgrade. MCP tokens are separate credentials; sign-out does not revoke them.

<a id="fr-1-7"></a>

- **FR-1.7 (M):** Admin-only endpoints (question bank management, Authorized Users management) must return `403 Forbidden` for `user`-role accounts.

<a id="fr-1-8"></a>

- **FR-1.8 (C):** **Deferred optional design.** Synchronizing an edge-level Cloudflare Access email policy is not implemented and is not required by the current cookie-auth deployment. Retain this ID for that original optional intent; no automatic Access policy synchronization is claimed.

<a id="fr-1-9"></a>

- **FR-1.9 (M):** A Google-authenticated account is identified by the OIDC `sub` claim of a verified ID token, stored as `users.google_sub`, not by its email address. A returning user is resolved by that subject first; only an account that carries no subject yet is located by the invited/legacy email association, and the subject is bound to it at that sign-in so every later one resolves by subject. Which subject a row ends up bound to is decided by the write, not by the read that preceded it: concurrent first sign-ins carrying different subjects for one address bind exactly one of them, and a sign-in whose subject was not the one stored is denied rather than given a session on it. An account already bound to a different subject is never rebound or merged on an email match — it is denied, and the sign-in screen says so specifically rather than advising another invitation, which would dead-end (the address is already on the list). Recovery is FR-1.10. The verified email is kept in step with the account for contact and display purposes (invitations, the daily review mail, the Authorized Users list), except where another account already holds that address, in which case the stored address is left unchanged. Subjects are provider-scoped: the `sub` in a Cloudflare Access JWT (`AUTH_MODE=access`) identifies the person to Access, not to Google, so that path stays on the email association and never writes `users.google_sub`.

<a id="fr-1-10"></a>

- **FR-1.10 (M):** From the Authorized Users screen, Admin can clear an account's stored Google subject. This is the recovery path for FR-1.9's conflict denial — the legitimate case being a person whose Google account was replaced rather than renamed, such as a consumer account displaced when its domain adopted Workspace. Clearing re-arms the one-time email binding, so the next successful Google sign-in on that address claims the account with its data intact; the row itself, and everything referencing its id, is untouched. Because the next sign-in wins the account, the action is confirmed and Admin-only. A subject can only ever be *cleared* here, never entered: subjects are written solely by a sign-in that verified them against Google's JWKS.

## User profiles

<a id="fr-12-1"></a>

- **FR-12.1 (M):** On an account's first successful sign-in (FR-1.3), the Worker initializes that user's display name and avatar from their Google account's OIDC profile claims (`name` and `picture`).

<a id="fr-12-2"></a>

- **FR-12.2 (M):** A user can edit their own display name at any time from their Settings page, overriding the Google-sourced default.

<a id="fr-12-3"></a>

- **FR-12.3 (M):** A user can upload a custom avatar image from their Settings page, overriding the Google-sourced default photo. Uploaded avatars are stored in Cloudflare R2 (see [storage and services](../architecture/system-overview.md#storage-and-services) for serving considerations).

<a id="fr-12-4"></a>

- **FR-12.4 (S):** Avatar uploads accept JPEG, PNG and WebP up to 2 MiB. The client prepares/resizes images before upload. The Worker validates the supported content type and size; avatars are served through the authenticated avatar route.

<a id="fr-12-5"></a>

- **FR-12.5 (M):** Display name and avatar — whether still Google-sourced or user-overridden — are shown wherever an account's identity is surfaced elsewhere in the app: shared Notes (FR-11.7), the Admin's Authorized Users list, and any other author/attribution UI.
