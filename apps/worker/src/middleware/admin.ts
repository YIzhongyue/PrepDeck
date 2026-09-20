import type { MiddlewareHandler } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";

// Admin-only endpoints must reject `user`-role accounts (FR-1.7). Must run
// after requireAccessUser, which populates c.get("user").
export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
};
