import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { updateSiteAppearanceRequestSchema } from "./appearance.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(updateSiteAppearanceRequestSchema, body), "Expected mascotStyle to be 3D-Chibi or 2D-Anime");
});

test("site appearance takes exactly one known mascot style", () => {
  assert.equal(error(updateSiteAppearanceRequestSchema, { mascotStyle: "2D-Anime" }), null);
  for (const body of [{}, [], { mascotStyle: "3D" }, { mascotStyle: "2D-Anime", extra: true }]) {
    assert.equal(error(updateSiteAppearanceRequestSchema, body), "Expected mascotStyle to be 3D-Chibi or 2D-Anime");
  }
});
