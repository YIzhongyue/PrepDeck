// implementation — thin wrapper around the Cloudflare Email Sending binding.
// E_* errors (see the Cloudflare Email Service docs) are left to propagate
// so the caller (scheduled/sendDailyReviewEmails.ts) can catch per-user and
// keep going for the rest of the batch.

import type { Env } from "../bindings";

export interface SendReviewEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

export async function sendReviewEmail(env: Env, input: SendReviewEmailInput): Promise<void> {
  await env.EMAIL.send({
    to: input.to,
    from: { email: env.EMAIL_FROM_ADDRESS, name: "PrepDeck" },
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  });
}
