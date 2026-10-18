import type { Env } from "../../../bindings";
import type { McpPrincipal } from "../../credentials";
import { identityAdapter } from "../shared";
import { createAdminAdapterContext } from "./context";
import { examOperations } from "./exams";
import { importOperations } from "./imports";
import { questionMutationOperations } from "./questionMutations";
import { questionReadOperations } from "./questionReads";
import { taxonomyOperations } from "./taxonomy";

// Admin MCP service adapter. Every operation requires an admin-audience
// principal (checked once below via identityAdapter) and reuses the same
// service-layer logic as the Admin REST routes and UI (lib/examManagement,
// lib/questionManagement, lib/questionQuality) rather than duplicating it.
// Reads live in questionReads.ts; every mutation is rate-limited, previewed
// or revision-checked, and audited in its own module.
export function createAdminMcpAdapter(principal: McpPrincipal, env: Env) {
  const identity = identityAdapter(principal, "admin");
  const ctx = createAdminAdapterContext(principal, env);
  return Object.freeze({
    ...identity,
    ...questionReadOperations(ctx),
    ...questionMutationOperations(ctx),
    ...examOperations(ctx),
    ...importOperations(ctx),
    ...taxonomyOperations(ctx),
  });
}
