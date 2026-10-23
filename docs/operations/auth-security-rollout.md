# Authentication boundary rollout

This change requires review and an explicit deployment decision. It does not
publish Google OAuth, change Google/Cloudflare settings or revoke an external
provider's sessions. No schema migration is required.

## Changes and regression coverage

| Area | Implemented boundary | Regression coverage |
| --- | --- | --- |
| Browser CSRF and media types | Exact configured Origin/Referer for unsafe browser routes; JSON content type except validated binary uploads; public bearer OAuth/MCP endpoints remain independent | `browser-request-security.test.mjs`, `session-credential-races.test.mjs` |
| Revocation and role changes | Browser/Access authorization reads current D1 primary rows; stale KV identity data ignored | `session-authority.test.mjs`, `session-lifecycle.test.mjs` |
| Binding recovery | Atomic session-version bump plus PAT/grant revocation; guarded identity updates and durable credential inserts prevent older admitted requests re-establishing access | `session-authority.test.mjs`, `session-credential-races.test.mjs`, `google-identity.test.mjs` |
| Google flow binding | Per-flow nonce in signed state and verified ID token, in addition to state and S256 PKCE | `oidc-validation.test.mjs`, `oauth-return-to.test.mjs` |
| JWT validation | RS256 only, strict audience types/expiry, optional nbf/iat bounds; OIDC azp policy only for Google | `oidc-validation.test.mjs` |
| Cookie isolation | HTTPS uses host-prefixed session/Google state cookies; no legacy fallback; duplicate matching cookie names rejected | `host-cookies.test.mjs` |
| MCP scope policy | Invalid explicit scope names rejected; omitted/empty scope requests read-only | `mcp-security-policy.test.mjs`, `mcp-oauth.test.mjs` |
| PAT lifetime | New tokens default30 days/max90; rotation applies cap; existing stored lifetimes unchanged | `mcp-security-policy.test.mjs`, `mcp-tokens.test.mjs`, web `mcp-setup.browser.mjs` |
| Metadata-client egress | Exact operator-controlled client-ID allowlist before cache/fetch; URL/redirect/timeout/size restrictions retained | `mcp-security-policy.test.mjs`, `mcp-oauth.test.mjs` |
| Trusted callback | Canonical HTTPS APP_BASE_URL and exact request-origin match; explicit development loopback exception; forwarded headers ignored | `google-origin.test.mjs` |

All Worker test filenames above live in `apps/worker/scripts/`. Tests use synthetic
accounts and local bindings. They do not prove production edge routing, cookie
behavior in every browser, external provider configuration or distributed timing.

## Required owner checks before rollout

1. Verify deployed revision and configuration source. APP_BASE_URL must be the
   exact canonical HTTPS origin used by the browser and MCP clients. Check the
   Google console's exact callback registration separately. Production must keep
   ENVIRONMENT=production and ENABLE_DEV_PASSWORD_LOGIN=false. Do not paste
   signing secrets into review material; verify secret management and HTTPS edge
   enforcement through the authorized operational process.
2. Inventory metadata-document MCP clients and configure
   MCP_OAUTH_METADATA_CLIENT_ALLOWLIST before deploying. See the precise JSON
   format and migration behavior in [MCP architecture](../architecture/mcp.md).
   An unset list intentionally denies new metadata-client authorization, including
   cached client records; existing issued grants/refresh tokens continue. Dynamic
   registration remains available. This must be an explicit owner decision, not
   an accidental interruption of existing supported client connection flows.
3. Only allow identifiers controlled by trusted client operators. An allowed
   hostname is not proof its resolved IP is public. Validate runtime DNS/egress
   protections (including rebinding/private destinations) in an authorized
   isolated runtime. No runtime DNS-safety guarantee is claimed by this code.
4. Notify users that existing browser cookies require one fresh sign-in and
   in-flight Google login flows must restart. Browser-cookie scripts must use the
   correct Origin and JSON media type. The local development helper is updated.
5. Existing PATs keep their stored expiration (including legacy nonexpiring
   tokens); owners should review and rotate/revoke them. New issue/rotation uses
   the finite policy. PATs remain audience-level credentials; use OAuth read-only
   grants for a read-only integration. Normal browser logout leaves MCP grants
   and PATs independent. Account revoke or Google binding reset retires all of
   that account's PrepDeck credentials without deleting its content.
6. Binding reset is not external Google/Cloudflare session revocation. In Access
   mode, a still-valid Access identity can authenticate again by email. For
   compromise recovery, keep the account revoked until external provider recovery
   is complete, or revoke the provider's sessions through a separately authorized
   operation. Role/status checks happen before request execution; ordinary work
   admitted before a mutation commits is not retroactively cancelled.
7. Budget for a primary D1 authorization lookup per browser request. Do not
   optimize security checks back into eventual-consistency KV or replica reads.
8. In authorized staging, verify invited and uninvited Google accounts, intended
   administrator roles, configured redirects, supported MCP connection/reconnect
   flows, and negative direct API access. Google Testing's basic-login scope
   exemption means its test-user list is not the application admission boundary.

Publishing OAuth and any verification requirements remain separate owner actions.
No production checks or deployment are performed by the local regression suite.

Local development uses the canonical Vite origin plus explicit `DEV_WORKER_ORIGIN=http://localhost:8787` for the built Worker UI. The additional origin is honored only with `ENVIRONMENT=development`, `ENABLE_DEV_PASSWORD_LOGIN=true`, and both configured origins restricted to HTTP loopback URLs. Production ignores this setting. The accessibility scan continues to exercise the Worker-served build.
