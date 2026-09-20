import { Hono } from "hono";
import type { QuestionTagsResponse } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { listTagCatalogNames } from "../lib/questionBankTags";
import { requireAdmin } from "../middleware/admin";

export const questionTagsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
questionTagsRouter.use("*", requireAdmin);

questionTagsRouter.get("/", async (c) => {
  const response: QuestionTagsResponse = { tags: await listTagCatalogNames(c.env.DB) };
  return c.json(response);
});
