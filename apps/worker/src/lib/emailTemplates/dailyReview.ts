// implementation — HTML + plaintext daily review email. Layout adapted from the
// Claude Design mock (daily-review-email.html/.preview.html), table-based
// MSO-safe markup, colors taken verbatim from apps/web/src/styles/tokens.css.
//
// Deliberate departures from the mock:
//  1. Per-question exam slug (a chip on each card) instead of one shared
//     "From this exam" block — a user's selection can span multiple exams.
//     The slug is shown instead of the full exam name/external ID to keep
//     the chip compact and stable.
//  2. The mock's "Answer key" section reveals the correct answer letter and
//     explanation inline. implementation requires the email NOT expose correct
//     answers or explanations by default, so this keeps the section's visual
//     shape but renders "Q1"/"Q2"/... buttons that deep-link into Learning
//     Mode for that exact question instead — no answer letter or explanation
//     text is ever built into this template. dailyReview.test.ts guards this
//     as a regression check.

import type { DailyEmailSource } from "@prepdeck/shared";
import type { DailyReviewQuestion } from "../dailyReviewSelection";

export interface DailyReviewEmailProps {
  displayName: string;
  dateLabel: string;
  source: DailyEmailSource;
  questions: DailyReviewQuestion[];
  logoUrl: string;
  ctaUrl: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  // implementation follow-up — base origin (e.g. "https://prepdeck.example.com")
  // used to build the per-question Learning Mode deep link
  // (/learning/exam?exam=<slug>&question_id=<id>) for each "See explanation"
  // button, so a click lands on that exact question instead of the app's
  // dashboard.
  appBaseUrl: string;
}

// Deep-links straight into Learning Mode for one question. The web app has
// no server-side router (App.tsx/PrepDeckContext.tsx serve everything from
// "/"), so this relies on the SPA fallback (wrangler.toml's
// not_found_handling = "single-page-application") plus a client-side bridge
// that resolves the exam slug to an examId and jumps in.
function learningQuestionUrl(appBaseUrl: string, examSlug: string, questionId: string): string {
  const url = new URL("/learning/exam", appBaseUrl);
  url.searchParams.set("exam", examSlug);
  url.searchParams.set("question_id", questionId);
  return url.toString();
}

const COPY: Record<DailyEmailSource, { kicker: string; heading: string; intro: string; ctaLabel: string; ctaFollowup: string }> = {
  wrong: {
    kicker: "Daily review",
    heading: "Questions you got wrong, back for another try",
    intro: "these came straight out of your wrong question book. Give each one a real attempt before you check the explanation in the app; that is where the learning happens.",
    ctaLabel: "Open my wrong question book",
    ctaFollowup: "Rather work through them in the app, with explanations and your notes? The button above drops you straight into the list."
  },
  bm: {
    kicker: "Daily review",
    heading: "Your saved bookmarks, revisited",
    intro: "a few questions you bookmarked for later. Give each one a real attempt before you check the explanation in the app.",
    ctaLabel: "Open my bookmarks",
    ctaFollowup: "Rather work through them in the app, with explanations and your notes? The button above drops you straight into the list."
  },
  new: {
    kicker: "Daily review",
    heading: "New questions to try today",
    intro: "a few questions you haven't attempted yet. Give each one a real attempt before you check the explanation in the app.",
    ctaLabel: "Start practicing",
    ctaFollowup: "Rather work through them in the app, with explanations and your notes? The button above drops you straight into practice."
  }
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

function questionCardHtml(q: DailyReviewQuestion, number: number): string {
  const examChip = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#ecfdf9;border-radius:999px;padding:4px 11px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:11px;line-height:14px;mso-line-height-rule:exactly;color:#115e59;white-space:nowrap;">${esc(q.examSlug)}</td></tr></table>`;
  const options = (q.options ?? [])
    .map(
      (opt, i) => `<tr>
        <td width="28" valign="top" style="padding:0 0 8px 0;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:14px;line-height:22px;mso-line-height-rule:exactly;font-weight:bold;color:#2563eb;">${OPTION_LETTERS[i] ?? i + 1}</td>
        <td valign="top" style="padding:0 0 8px 0;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:#4b596c;">${esc(opt.text)}</td>
      </tr>`
    )
    .join("");

  return `<tr>
  <td style="padding:0 28px 14px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f8fafc;border:1px solid #dbe3ef;border-radius:22px;">
      <tr>
        <td style="padding:20px 22px 4px 22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
            <tr>
              <td width="26" valign="top" style="font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:13px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;color:#1d4ed8;">${number}</td>
              <td valign="top">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="padding:0 6px 6px 0;">${examChip}</td>
                </tr></table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 22px 14px 22px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#172033;">${esc(q.stem)}</td>
      </tr>${
        options
          ? `<tr><td style="padding:0 22px 14px 22px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${options}</table></td></tr>`
          : ""
      }
    </table>
  </td>
</tr>`;
}

function explanationButtonHtml(q: DailyReviewQuestion, number: number, appBaseUrl: string): string {
  const url = learningQuestionUrl(appBaseUrl, q.examSlug, q.id);
  return `<a href="${url}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 20px;background-color:#ffffff;border:1px solid #99f0e0;border-radius:999px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:14px;line-height:18px;mso-line-height-rule:exactly;font-weight:bold;color:#0f766e;text-decoration:none;">Q${number}</a>`;
}

export function renderDailyReviewHtml(props: DailyReviewEmailProps): string {
  const copy = COPY[props.source];
  const preheader = `${props.questions.length} question${props.questions.length === 1 ? "" : "s"} for you today — a few focused minutes, then you are done.`;

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your daily review &middot; PrepDeck</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{border:0;line-height:100%;outline:none;text-decoration:none;}
  a{text-underline-offset:3px;}
  @media only screen and (max-width:620px){
    .pd-shell{width:100% !important;}
    .pd-pad{padding-left:16px !important;padding-right:16px !important;}
    .pd-h1{font-size:26px !important;line-height:32px !important;}
    .pd-btn{display:block !important;width:100% !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;">
<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#eef2f7;">
  <tr>
    <td align="center" style="padding:24px 12px 40px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="pd-shell" style="width:600px;max-width:600px;">

        <tr>
          <td class="pd-pad" style="padding:4px 28px 16px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
              <tr>
                <td align="left" style="line-height:0;font-size:0;"><img src="${props.logoUrl}" width="170" height="35" alt="PrepDeck" style="display:block;width:170px;height:35px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;"></td>
                <td align="right" style="font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:12px;line-height:24px;mso-line-height-rule:exactly;color:#68778c;">${esc(props.dateLabel)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;border-radius:28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">

              <tr>
                <td class="pd-pad" style="padding:32px 28px 6px 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:11px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:#1d4ed8;font-weight:bold;">${copy.kicker}</td>
              </tr>
              <tr>
                <td class="pd-pad pd-h1" style="padding:0 28px 10px 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:30px;line-height:36px;mso-line-height-rule:exactly;letter-spacing:-0.6px;font-weight:bold;color:#172033;">${esc(copy.heading)}</td>
              </tr>
              <tr>
                <td class="pd-pad" style="padding:0 28px 18px 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#4b596c;">Morning, ${esc(props.displayName)} &mdash; ${esc(copy.intro)}</td>
              </tr>

              ${props.questions.map((q, i) => questionCardHtml(q, i + 1)).join("")}

              <tr>
                <td class="pd-pad" style="padding:8px 28px 4px 28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 0 0;">
                    <tr>
                      <td class="pd-btn" bgcolor="#2563eb" style="background-color:#2563eb;border-radius:999px;">
                        <a href="${props.ctaUrl}" class="pd-btn" style="display:block;padding:14px 26px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:15px;line-height:18px;mso-line-height-rule:exactly;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(copy.ctaLabel)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="pd-pad" style="padding:12px 28px 26px 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:#68778c;">${esc(copy.ctaFollowup)}</td>
              </tr>

              <tr>
                <td class="pd-pad" style="padding:0 28px 0 28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td height="1" style="height:1px;background-color:#dbe3ef;font-size:0;line-height:0;">&nbsp;</td></tr></table>
                </td>
              </tr>

              <tr>
                <td class="pd-pad" style="padding:24px 28px 6px 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:11px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:#115e59;font-weight:bold;">Explanations</td>
              </tr>
              <tr>
                <td class="pd-pad" style="padding:0 28px 8px 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:#68778c;">Try each question first &mdash; explanations and correct answers stay in the app, not in this email.</td>
              </tr>
              <tr>
                <td class="pd-pad" style="padding:10px 28px 8px 28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#ecfdf9;border-radius:22px;">
                    <tr><td style="padding:20px 22px 18px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                        <tr>
                          <td style="padding:0 0 12px 0;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:11px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:#115e59;font-weight:bold;">Open an explanation in PrepDeck</td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 12px 0;">
                            ${props.questions.map((q, i) => explanationButtonHtml(q, i + 1, props.appBaseUrl)).join("")}
                          </td>
                        </tr>
                        <tr>
                          <td style="font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:12px;line-height:18px;mso-line-height-rule:exactly;color:#4b7b73;">Tap a question number to jump straight to see the answer in PrepDeck</td>
                        </tr>
                      </table>
                    </td></tr>
                  </table>
                </td>
              </tr>
              <tr><td style="height:28px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="pd-pad" style="padding:22px 28px 0 28px;font-family:Arial, Helvetica, 'Segoe UI', sans-serif;font-size:12px;line-height:20px;mso-line-height-rule:exactly;color:#68778c;">
            You get this because daily review is on for your PrepDeck account.<br>
            <a href="${props.settingsUrl}" style="color:#2563eb;text-decoration:underline;">Change how often I get these</a> &nbsp;&middot;&nbsp;
            <a href="${props.unsubscribeUrl}" style="color:#2563eb;text-decoration:underline;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

export function renderDailyReviewText(props: DailyReviewEmailProps): string {
  const copy = COPY[props.source];
  const lines: string[] = [];
  lines.push(`${copy.heading} — PrepDeck`);
  lines.push(`Morning, ${props.displayName} — ${copy.intro}`);
  lines.push("");
  props.questions.forEach((q, i) => {
    lines.push(`${i + 1}. [${q.examSlug}] ${q.stem}`);
    (q.options ?? []).forEach((opt, j) => {
      lines.push(`   ${OPTION_LETTERS[j] ?? j + 1}. ${opt.text}`);
    });
    lines.push(`   See the explanation in PrepDeck: ${learningQuestionUrl(props.appBaseUrl, q.examSlug, q.id)}`);
    lines.push("");
  });
  lines.push(`${copy.ctaLabel}: ${props.ctaUrl}`);
  lines.push("");
  lines.push("Explanations and correct answers stay in the app, not in this email.");
  lines.push("");
  lines.push(`Change how often you get these: ${props.settingsUrl}`);
  lines.push(`Unsubscribe: ${props.unsubscribeUrl}`);
  return lines.join("\n");
}
