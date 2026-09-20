// implementation — per-user display aliases for the three annotation "mark"
// styles (hl1/hl2/hl3). Purely additive/presentational: no colors are
// stored here, and the annotations table itself is untouched (style
// already stores the logical slot, not a raw color). Ownership-scoped the
// same way as every other per-user table in this codebase (annotations.ts,
// notes.ts, settings.ts).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { DEFAULT_MARK_ALIASES } from "@prepdeck/shared";
import { aliasValidationError, resolveMarkAlias } from "../lib/annotationSettings";

interface AnnotationSettingsRow {
  hl1_alias: string;
  hl2_alias: string;
  hl3_alias: string;
}

function toResponse(row: AnnotationSettingsRow | null) {
  return {
    hl1Alias: row?.hl1_alias ?? DEFAULT_MARK_ALIASES.hl1,
    hl2Alias: row?.hl2_alias ?? DEFAULT_MARK_ALIASES.hl2,
    hl3Alias: row?.hl3_alias ?? DEFAULT_MARK_ALIASES.hl3
  };
}

// Mounted at /api/annotation-settings.
export const annotationSettingsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

annotationSettingsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare(
    "SELECT hl1_alias, hl2_alias, hl3_alias FROM user_annotation_settings WHERE user_id = ?"
  )
    .bind(userId)
    .first<AnnotationSettingsRow>();
  return c.json(toResponse(row ?? null));
});

annotationSettingsRouter.patch("/", async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);

  if (body.hl1Alias === undefined && body.hl2Alias === undefined && body.hl3Alias === undefined) {
    return c.json({ error: "Provide at least one of hl1Alias, hl2Alias, hl3Alias" }, 400);
  }

  for (const [field, value] of [["hl1Alias", body.hl1Alias], ["hl2Alias", body.hl2Alias], ["hl3Alias", body.hl3Alias]] as const) {
    const error = aliasValidationError(field, value);
    if (error) return c.json({ error }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT hl1_alias, hl2_alias, hl3_alias FROM user_annotation_settings WHERE user_id = ?"
  )
    .bind(userId)
    .first<AnnotationSettingsRow>();

  const resolved = {
    hl1: resolveMarkAlias(body.hl1Alias, existing?.hl1_alias, "hl1" as const),
    hl2: resolveMarkAlias(body.hl2Alias, existing?.hl2_alias, "hl2" as const),
    hl3: resolveMarkAlias(body.hl3Alias, existing?.hl3_alias, "hl3" as const)
  };

  const now = new Date().toISOString();
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE user_annotation_settings SET hl1_alias = ?, hl2_alias = ?, hl3_alias = ?, updated_at = ? WHERE user_id = ?"
    )
      .bind(resolved.hl1, resolved.hl2, resolved.hl3, now, userId)
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO user_annotation_settings (user_id, hl1_alias, hl2_alias, hl3_alias, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(userId, resolved.hl1, resolved.hl2, resolved.hl3, now, now)
      .run();
  }

  return c.json({ hl1Alias: resolved.hl1, hl2Alias: resolved.hl2, hl3Alias: resolved.hl3 });
});
