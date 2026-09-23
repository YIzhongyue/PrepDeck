import { Hono } from "hono";
import { getImportSchemas } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";

// Read-only discovery for any authenticated user. Import mutations remain admin-only.
export const importSchemasRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
importSchemasRouter.get("/", (c) => c.json(getImportSchemas()));
