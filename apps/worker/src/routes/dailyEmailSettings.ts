// implementation — per-user daily question review email settings (Settings page).
// Same GET-with-defaults / PATCH-with-per-field-validation / upsert shape as
// routes/annotationSettings.ts.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type { DailyEmailSource } from "@prepdeck/shared";
import { dailyEmailSettingsValidationError } from "../lib/dailyEmailSettings";

interface DailyEmailSettingsRow {
  enabled: number;
  questions_per_email: number;
  source: DailyEmailSource;
  timezone: string;
  send_hour_local: number;
  unsubscribed_at: string | null;
}

const DEFAULTS: Omit<DailyEmailSettingsRow, "unsubscribed_at"> = {
  enabled: 0,
  questions_per_email: 3,
  source: "wrong",
  timezone: "UTC",
  send_hour_local: 8
};

function toResponse(row: DailyEmailSettingsRow | null) {
  return {
    enabled: !!(row?.enabled ?? DEFAULTS.enabled),
    questionsPerEmail: row?.questions_per_email ?? DEFAULTS.questions_per_email,
    source: row?.source ?? DEFAULTS.source,
    timezone: row?.timezone ?? DEFAULTS.timezone,
    sendHourLocal: row?.send_hour_local ?? DEFAULTS.send_hour_local,
    unsubscribedAt: row?.unsubscribed_at ?? null
  };
}

const SELECT_COLUMNS = "enabled, questions_per_email, source, timezone, send_hour_local, unsubscribed_at";

// Mounted at /api/daily-email-settings.
export const dailyEmailSettingsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

dailyEmailSettingsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM user_email_settings WHERE user_id = ?`)
    .bind(userId)
    .first<DailyEmailSettingsRow>();
  return c.json(toResponse(row ?? null));
});

dailyEmailSettingsRouter.patch("/", async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);

  const fields = ["enabled", "questionsPerEmail", "source", "timezone", "sendHourLocal"] as const;
  if (fields.every((field) => body[field] === undefined)) {
    return c.json({ error: `Provide at least one of ${fields.join(", ")}` }, 400);
  }
  for (const field of fields) {
    const error = dailyEmailSettingsValidationError(field, body[field]);
    if (error) return c.json({ error }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM user_email_settings WHERE user_id = ?`)
    .bind(userId)
    .first<DailyEmailSettingsRow>();

  const resolved: Omit<DailyEmailSettingsRow, "unsubscribed_at"> = {
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : (existing?.enabled ?? DEFAULTS.enabled),
    questions_per_email: body.questionsPerEmail !== undefined ? body.questionsPerEmail : (existing?.questions_per_email ?? DEFAULTS.questions_per_email),
    source: body.source !== undefined ? body.source : (existing?.source ?? DEFAULTS.source),
    timezone: body.timezone !== undefined ? body.timezone : (existing?.timezone ?? DEFAULTS.timezone),
    send_hour_local: body.sendHourLocal !== undefined ? body.sendHourLocal : (existing?.send_hour_local ?? DEFAULTS.send_hour_local)
  };

  const now = new Date().toISOString();
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE user_email_settings SET enabled = ?, questions_per_email = ?, source = ?, timezone = ?, send_hour_local = ?, updated_at = ? WHERE user_id = ?"
    )
      .bind(resolved.enabled, resolved.questions_per_email, resolved.source, resolved.timezone, resolved.send_hour_local, now, userId)
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO user_email_settings (user_id, enabled, questions_per_email, source, timezone, send_hour_local, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(userId, resolved.enabled, resolved.questions_per_email, resolved.source, resolved.timezone, resolved.send_hour_local, now, now)
      .run();
  }

  return c.json(toResponse({ ...resolved, unsubscribed_at: existing?.unsubscribed_at ?? null }));
});
