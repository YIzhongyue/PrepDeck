// Cleanup of legacy identity-cache entries during the authorization rollout.
// No authorization path reads or populates these entries: status, role and
// session version are checked against D1's primary on every request.
import type { Env } from "../bindings";
import { optionalCache, cacheSingleFlight } from "./optionalCache";

export async function invalidateCachedUser(env: Env, id: string, email: string): Promise<void> {
  await cacheSingleFlight(env.KV, JSON.stringify(["legacy-user-delete", id, email]), () =>
    optionalCache(env.KV, "legacy_identity_cleanup", "delete", undefined, async () => {
      await Promise.all([env.KV.delete(`user-cache:id:${id}`), env.KV.delete(`user-cache:email:${email}`)]);
    }));
}
