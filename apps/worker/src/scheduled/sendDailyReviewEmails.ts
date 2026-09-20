// implementation — daily question review email delivery. Runs on the */15 * * * *
// trigger in wrangler.toml (branched to from src/index.ts's scheduled
// handler). Shaped like scheduled/cleanupKnowledgePointImages.ts: a plain
// async function taking env, no D1/R2 unit test (repo convention — see that
// file's own comment).

import type { Env } from "../bindings";
import type { DailyEmailSource } from "@prepdeck/shared";
import { createUnsubscribeToken } from "../lib/unsubscribeToken";
import { recentlySentQuestionIds, selectDailyReviewQuestions } from "../lib/dailyReviewSelection";
import { renderDailyReviewHtml, renderDailyReviewText } from "../lib/emailTemplates/dailyReview";
import { sendReviewEmail } from "../lib/email";

interface EmailSettingsRow {
  user_id: string;
  questions_per_email: number;
  source: DailyEmailSource;
  timezone: string;
  send_hour_local: number;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
}

function localDateAndHour(timezone: string, atMs: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(new Date(atMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // en-CA gives YYYY-MM-DD ordering for year/month/day parts; hour can be "24"
  // for midnight in some ICU implementations — normalize to 0.
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

const CTA_SCREEN: Record<DailyEmailSource, string> = { wrong: "wrong", bm: "bookmarks", new: "practice" };

function ctaUrl(appBaseUrl: string, source: DailyEmailSource): string {
  const url = new URL(appBaseUrl);
  url.searchParams.set("screen", CTA_SCREEN[source]);
  if (source === "new") url.searchParams.set("source", "new");
  return url.toString();
}

export interface DailyReviewEmailRunResult {
  sent: number;
  skipped: number;
  failed: number;
}

export async function runDailyReviewEmailDelivery(env: Env, now: () => number = Date.now): Promise<DailyReviewEmailRunResult> {
  const settings = await env.DB.prepare(
    "SELECT user_id, questions_per_email, source, timezone, send_hour_local FROM user_email_settings WHERE enabled = 1"
  ).all<EmailSettingsRow>();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of settings.results ?? []) {
    try {
      const { date: localDate, hour: localHour } = localDateAndHour(row.timezone, now());
      if (localHour !== row.send_hour_local) continue;

      const user = await env.DB.prepare("SELECT id, email, display_name, status FROM users WHERE id = ?")
        .bind(row.user_id)
        .first<UserRow>();
      if (!user || user.status !== "active") continue;

      // Claim the day first: duplicate emails from overlapping/retried runs
      // are explicitly worse than an occasional missed day (implementation).
      const claim = await env.DB.prepare(
        "INSERT INTO daily_review_email_deliveries (user_id, local_date, sent_at, question_ids_json) VALUES (?, ?, ?, '[]') ON CONFLICT(user_id, local_date) DO NOTHING"
      )
        .bind(row.user_id, localDate, new Date(now()).toISOString())
        .run();
      if (claim.meta.changes === 0) {
        skipped++;
        continue;
      }

      const exclude = await recentlySentQuestionIds(env.DB, row.user_id, 3);
      const questions = await selectDailyReviewQuestions(env.DB, row.user_id, row.source, row.questions_per_email, exclude);
      if (questions.length === 0) {
        // No eligible questions today — the claim stays (no empty email, and
        // no point re-querying the rest of this hour's 15-minute ticks).
        skipped++;
        continue;
      }

      const token = await createUnsubscribeToken(row.user_id, env);
      const unsubscribeUrl = `${env.APP_BASE_URL}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
      const settingsUrl = `${env.APP_BASE_URL}/?screen=settings`;
      const cta = ctaUrl(env.APP_BASE_URL, row.source);
      const displayName = user.display_name?.trim() || "there";
      const dateLabel = new Intl.DateTimeFormat("en-US", {
        timeZone: row.timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(new Date(now()));

      const props = {
        displayName,
        dateLabel,
        source: row.source,
        questions,
        logoUrl: new URL("/email/prepdeck-logo.png", env.APP_BASE_URL).toString(),
        ctaUrl: cta,
        settingsUrl,
        unsubscribeUrl,
        appBaseUrl: env.APP_BASE_URL
      };

      await sendReviewEmail(env, {
        to: user.email,
        subject: "Your daily practice questions — PrepDeck",
        html: renderDailyReviewHtml(props),
        text: renderDailyReviewText(props),
        unsubscribeUrl
      });

      await env.DB.prepare("UPDATE daily_review_email_deliveries SET question_ids_json = ? WHERE user_id = ? AND local_date = ?")
        .bind(JSON.stringify(questions.map((q) => q.id)), row.user_id, localDate)
        .run();
      sent++;
    } catch (error) {
      failed++;
      // Never log token, html, or question content — just enough to diagnose.
      console.error("dailyReviewEmail.delivery_failed", {
        userId: row.user_id,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  return { sent, skipped, failed };
}
