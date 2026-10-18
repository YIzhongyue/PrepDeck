import { Hono } from "hono";
import type { Env } from "./bindings";
import type { McpObservation } from "./mcp/observability";

// Hono `Variables` set by middleware/access.ts once a request's identity has
// been resolved (FR-1.3) — never trust a client-supplied role (FR-1.6).

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "user";
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Variables {
  user: AuthUser;
  mcpObservation?: McpObservation;
}

// The one Hono environment every router, middleware and handler context in
// this Worker shares.
export type AppEnv = { Bindings: Env; Variables: Variables };

export const createRouter = () => new Hono<AppEnv>();
