// implementation — one-click unsubscribe for the daily review email. Public: the
// click comes from an email with no session cookie, so this router is
// mounted directly on the root app (like routes/auth.ts), not the
// requireAccessUser-gated /api group. GET renders a confirmation/error page
// for a human clicking the link in the email body; POST is the RFC 8058
// one-click target that mail clients auto-hit when List-Unsubscribe-Post is
// present, and must return a bare success with no page (see lib/email.ts for
// the headers). Both are idempotent: repeating either is always safe.

import { Hono, type Context } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { verifyUnsubscribeToken } from "../lib/unsubscribeToken";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

function page(title: string, body: string, status: 200 | 400): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · PrepDeck</title>
<style>
  body{margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,'Segoe UI',sans-serif;color:#172033;}
  .wrap{max-width:480px;margin:64px auto;padding:32px;background:#ffffff;border-radius:28px;text-align:center;}
  h1{font-size:22px;margin:0 0 12px;}
  p{font-size:15px;line-height:24px;color:#4b596c;margin:0 0 20px;}
  a{color:#2563eb;text-decoration:underline;}
</style>
</head>
<body>
<div class="wrap"><h1>${title}</h1>${body}</div>
</body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function unsubscribe(c: AppContext): Promise<{ ok: boolean }> {
  const token = c.req.query("token");
  if (!token) return { ok: false };
  const verified = await verifyUnsubscribeToken(token, c.env);
  if (!verified) return { ok: false };

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE user_email_settings SET enabled = 0, unsubscribed_at = ?, updated_at = ? WHERE user_id = ?"
  )
    .bind(now, now, verified.userId)
    .run();
  return { ok: true };
}

// Mounted at /api/email/unsubscribe.
export const unsubscribeRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

unsubscribeRouter.get("/", async (c) => {
  const result = await unsubscribe(c);
  if (!result.ok) {
    return page(
      "Link not valid",
      `<p>This unsubscribe link is invalid or has already been used differently than expected. You can also turn off daily review emails from PrepDeck Settings.</p><p><a href="${c.env.APP_BASE_URL}/?screen=settings">Open PrepDeck Settings</a></p>`,
      400
    );
  }
  return page(
    "You're unsubscribed",
    `<p>Daily review emails are now turned off for your PrepDeck account. You can turn them back on any time from Settings.</p><p><a href="${c.env.APP_BASE_URL}/?screen=settings">Open PrepDeck Settings</a></p>`,
    200
  );
});

// RFC 8058 one-click unsubscribe: mail clients auto-POST here with no user
// interaction when List-Unsubscribe-Post is present. Must not depend on the
// GET page's markup and must not require a body.
unsubscribeRouter.post("/", async (c) => {
  const result = await unsubscribe(c);
  return c.body(null, result.ok ? 200 : 400);
});
