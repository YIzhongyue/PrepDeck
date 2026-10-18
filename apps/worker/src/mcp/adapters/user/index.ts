import type { Env } from "../../../bindings";
import type { McpPrincipal } from "../../credentials";
import { identityAdapter } from "../shared";
import { createUserAdapterContext } from "./context";
import { knowledgePointOperations } from "./knowledgePoints";
import { reviewOperations } from "./review";
import { studyOperations } from "./study";

// implementation — User MCP learning, history, and question discovery tools.
// Reads remain side-effect free. Explicit study mutations use the canonical
// attempt and Learning Mode services, just like the REST routes. Every operation is
// scoped exclusively to `principal.userId` (checked once via identityAdapter
// above) and never accepts a caller-supplied userId/ownerId. Reuses the same
// service-layer logic as the REST routes and Admin MCP where it already
// exists (lib/examManagement, lib/questionManagement) and adds new
// extracted/pure query modules where no REST equivalent existed yet
// (lib/attemptQuery, lib/wrongBookQuery, lib/bookmarksQuery,
// lib/unattemptedQuery, lib/practiceSelection, lib/annotationsQuery).
export function createUserMcpAdapter(principal: McpPrincipal, env: Env) {
  const identity = identityAdapter(principal, "user");
  const ctx = createUserAdapterContext(principal, env);
  return Object.freeze({
    ...identity,
    ...studyOperations(ctx),
    ...reviewOperations(ctx),
    ...knowledgePointOperations(ctx),
  });
}
