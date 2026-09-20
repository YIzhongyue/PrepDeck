import assert from "node:assert/strict";
import test from "node:test";
import { renderDailyReviewHtml, renderDailyReviewText, type DailyReviewEmailProps } from "./dailyReview.ts";

const props: DailyReviewEmailProps = {
  displayName: "Zhongyue",
  dateLabel: "Tuesday, 8 September 2026",
  source: "wrong",
  logoUrl: "https://assets.prepdeck.example.com/PrepDeck-horizontal-logo-blue.png",
  ctaUrl: "https://prepdeck.example.com/?screen=wrong",
  settingsUrl: "https://prepdeck.example.com/?screen=settings",
  unsubscribeUrl: "https://prepdeck.example.com/api/email/unsubscribe?token=abc123secrettoken",
  appBaseUrl: "https://prepdeck.example.com",
  questions: [
    {
      id: "q1",
      examId: "e1",
      examName: "AWS Certified Solutions Architect",
      examSlug: "aws-sap-c02",
      externalId: "SAP-C02 #142",
      sequenceNumber: 142,
      type: "single_choice",
      stem: "Which approach meets the requirement with the least operational overhead?",
      options: [
        { id: "a", text: "Deploy Route 53 Resolver inbound endpoints." },
        { id: "b", text: "Run BIND forwarders on EC2." }
      ],
      tags: ["Networking"]
    },
    {
      id: "q2",
      examId: "e1",
      examName: "AWS Certified Solutions Architect",
      examSlug: "aws-sap-c02",
      externalId: "SAP-C02 #087",
      sequenceNumber: 87,
      type: "single_choice",
      stem: "Which lifecycle configuration is most cost-effective?",
      options: [
        { id: "a", text: "Transition to S3 Glacier Instant Retrieval after 30 days." },
        { id: "b", text: "Enable S3 Intelligent-Tiering with no transitions." }
      ],
      tags: ["Storage"]
    }
  ]
};

// This is the regression guard for implementation's core safety requirement: the
// daily email must never expose correct answers or explanations. These are
// deliberately NOT part of DailyReviewEmailProps/DailyReviewQuestion, but
// this test also checks for plausible leaked answer markers in case a future
// edit adds an answer/explanation field to the props. Doesn't check for the
// bare word "explanation" — the template legitimately says things like "See
// explanation in PrepDeck" without ever rendering explanation content.
const FORBIDDEN_SNIPPETS = ["Answer: A", "Answer: B", "correctAnswers"];

test("HTML output contains every question and the required links, never an answer key", () => {
  const html = renderDailyReviewHtml(props);
  for (const [i, q] of props.questions.entries()) {
    assert.ok(html.includes(q.stem), `missing stem for ${q.id}`);
    assert.ok(html.includes(q.examSlug), `missing examSlug for ${q.id}`);
    assert.ok(!html.includes(q.externalId!), `HTML unexpectedly contains externalId for ${q.id}`);
    assert.ok(html.includes(`>Q${i + 1}<`), `missing Q${i + 1} explanation button`);
    assert.ok(
      html.includes(`/learning/exam?exam=${q.examSlug}&question_id=${q.id}`),
      `missing Learning Mode deep link for ${q.id}`
    );
  }
  assert.ok(html.includes(props.ctaUrl));
  assert.ok(html.includes(props.unsubscribeUrl));
  assert.ok(html.includes(props.settingsUrl));
  assert.ok(html.includes(props.logoUrl));
  for (const snippet of FORBIDDEN_SNIPPETS) {
    assert.ok(!html.includes(snippet), `HTML unexpectedly contains "${snippet}"`);
  }
});

test("plaintext output contains every question and the required links, never an answer key", () => {
  const text = renderDailyReviewText(props);
  for (const q of props.questions) {
    assert.ok(text.includes(q.stem), `missing stem for ${q.id}`);
    assert.ok(text.includes(q.examSlug), `missing examSlug for ${q.id}`);
    assert.ok(
      text.includes(`/learning/exam?exam=${q.examSlug}&question_id=${q.id}`),
      `missing Learning Mode deep link for ${q.id}`
    );
  }
  assert.ok(text.includes(props.ctaUrl));
  assert.ok(text.includes(props.unsubscribeUrl));
  for (const snippet of FORBIDDEN_SNIPPETS) {
    assert.ok(!text.includes(snippet), `text unexpectedly contains "${snippet}"`);
  }
});

test("escapes HTML-significant characters in user-controlled question text", () => {
  const html = renderDailyReviewHtml({
    ...props,
    questions: [{ ...props.questions[0], stem: `<script>alert("x")</script> & "quoted"` }]
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});
