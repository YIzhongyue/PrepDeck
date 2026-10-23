// Cleanup of legacy identity-cache entries during the authorization rollout.
// No authorization path reads or populates these entries: status, role and
// session version are checked against D1's primary on every request.
import type { Env } from "../bindings";

export async function invalidateCachedUser(env: Env, id: string, email: string): Promise<void> {
  await Promise.all([env.KV.delete(`user-cache:id:${id}`), env.KV.delete(`user-cache:email:${email}`)]);
}
