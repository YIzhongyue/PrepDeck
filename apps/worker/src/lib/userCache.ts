// Short-lived KV cache for the resolved `users` row that middleware/access.ts
// re-derives on every authenticated request. Session/JWT verification itself
// is cheap (HMAC or RSA verify); the expensive part this cache avoids is the
// D1 round-trip (a SELECT, plus an UPDATE last_login_at in Access mode) that
// would otherwise run before every single API call. Explicit invalidation
// (invalidateCachedUser, called from routes/adminUsers.ts and routes/profile.ts)
// keeps the common cases — revoke, role change, rename, avatar change —
// instant rather than waiting out the TTL.

import type { Env } from "../bindings";

export interface CachedUserRow {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "invited" | "active" | "revoked";
  display_name: string | null;
  avatar_url: string | null;
}

// TTL is deliberately a few minutes, not seconds: Workers KV's free tier caps
// writes at 1,000/day (docs/architecture/system-overview.md#storage-and-services ), and a cache
// refresh writes two keys (id + email). A too-short TTL turns this into an
// effectively per-request write under continuous use and can blow through
// that cap; a several-minute TTL keeps the worst case bounded even with
// every one of the ≤10 target users active at once, at the cost of a revoked
// account staying reachable for up to one TTL window (accepted trade-off for
// a small, trusted user base — see docs/requirements/non-functional-requirements.md#security-and-privacy).
const TTL_SECONDS = 600;

const idKey = (id: string) => `user-cache:id:${id}`;
const emailKey = (email: string) => `user-cache:email:${email}`;

export async function getCachedUserById(env: Env, id: string): Promise<CachedUserRow | null> {
  return (await env.KV.get(idKey(id), "json")) as CachedUserRow | null;
}

export async function getCachedUserByEmail(env: Env, email: string): Promise<CachedUserRow | null> {
  return (await env.KV.get(emailKey(email), "json")) as CachedUserRow | null;
}

export async function setCachedUser(env: Env, row: CachedUserRow): Promise<void> {
  const value = JSON.stringify(row);
  await Promise.all([
    env.KV.put(idKey(row.id), value, { expirationTtl: TTL_SECONDS }),
    env.KV.put(emailKey(row.email), value, { expirationTtl: TTL_SECONDS }),
  ]);
}

export async function invalidateCachedUser(env: Env, id: string, email: string): Promise<void> {
  await Promise.all([env.KV.delete(idKey(id)), env.KV.delete(emailKey(email))]);
}
