import type { QuestionTagsResponse } from "@prepdeck/shared";
import { createRouter } from "../context";
import { listTagCatalogNames } from "../lib/questionBankTags";
import { requireAdmin } from "../middleware/admin";

export const questionTagsRouter = createRouter();
questionTagsRouter.use("*", requireAdmin);

questionTagsRouter.get("/", async (c) => {
  const response: QuestionTagsResponse = { tags: await listTagCatalogNames(c.env.DB) };
  return c.json(response);
});
