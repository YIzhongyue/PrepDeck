import { Hono } from "hono";
import type { Env } from "./bindings";
import type { Variables } from "./context";
import { requireAccessUser } from "./middleware/access";
import { authRouter } from "./routes/auth";
import { examBadgesRouter, examsRouter } from "./routes/exams";
import { questionsRouter } from "./routes/questions";
import { questionTagsRouter } from "./routes/questionTags";
import { importsRouter } from "./routes/imports";
import { practiceCatalogRouter } from "./routes/practice";
import { examAttemptsRouter, attemptsRouter } from "./routes/attempts";
import { learningDetailRouter, learningProgressRouter } from "./routes/learning";
import { bookmarksRouter } from "./routes/bookmarks";
import { wrongBookMasteredRouter } from "./routes/wrongBook";
import { questionAnnotationsRouter, annotationsRouter } from "./routes/annotations";
import { annotationSettingsRouter } from "./routes/annotationSettings";
import { questionNotesRouter, notesRouter } from "./routes/notes";
import { knowledgePointsRouter } from "./routes/knowledgePoints";
import { knowledgePointQuestionSearchRouter } from "./routes/knowledgePointQuestionSearch";
import { knowledgePointGroupsRouter } from "./routes/knowledgePointGroups";
import { knowledgePointTagsRouter } from "./routes/knowledgePointTags";
import { kpImagesRouter } from "./routes/kpImages";
import { settingsRouter } from "./routes/settings";
import { dailyEmailSettingsRouter } from "./routes/dailyEmailSettings";
import { unsubscribeRouter } from "./routes/unsubscribe";
import { profileRouter, avatarsRouter } from "./routes/profile";
import { examStatsRouter, studyActivityRouter } from "./routes/stats";
import { examPreferencesRouter } from "./routes/examPreferences";
import { questionAiExplanationsRouter, aiGenerateRouter } from "./routes/ai";
import { adminUsersRouter } from "./routes/adminUsers";
import { adminOverviewRouter } from "./routes/adminOverview";
import { providerIconsRouter, providersRouter } from "./routes/providers";
import { generalRateLimit, authenticatedRateLimit } from "./middleware/rateLimit";
import { circuitBreaker } from "./middleware/circuitBreaker";
import { runKnowledgePointImageCleanup } from "./scheduled/cleanupKnowledgePointImages";
import { runContentMutationAuditPrune } from "./scheduled/pruneContentMutationAudit";
import { runDailyReviewEmailDelivery } from "./scheduled/sendDailyReviewEmails";
import { userMcpRouter, adminMcpRouter } from "./mcp/routes";
import { createMcpTokensRouter } from "./routes/mcpTokens";
import { observeMcp } from "./mcp/observability";
export { RateLimiterObject } from "./rateLimiterObject";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// A bounded, best-effort Analytics Engine counter also observes early rejects.
// It never reads credentials or calls D1/KV/R2/the rate-limiter service.
app.use("/mcp/*", observeMcp);
app.use("/admin-mcp/*", observeMcp);

// Keep these before business handling: an open circuit returns before authentication,
// storage or route handling; rate limiting is defense in depth
// behind Cloudflare's edge WAF/rules. The circuit decision is computed only
// from Worker vars and request metadata, so rejected traffic cannot cause
// D1/KV/R2 operations.
for (const path of ["/api/*", "/mcp/*", "/admin-mcp/*"]) {
  app.use(path, circuitBreaker);
  app.use(path, generalRateLimit);
}

// Health check — no auth required.
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Dev-mode email+password login (/login, /logout are public; /me requires a
// valid session/Access identity, per requireAccessUser — see routes/auth.ts).
app.route("/api/auth", authRouter);
// implementation — the click comes from an email, so there's no session cookie;
// authorized instead by a signed, scoped token (lib/unsubscribeToken.ts).
app.route("/api/email/unsubscribe", unsubscribeRouter);

// Independent bearer-only MCP audiences; remain behind circuit/IP protection
// above, but never inherit browser session/Cloudflare Access authentication.
app.route("/mcp", userMcpRouter);
app.route("/admin-mcp", adminMcpRouter);

// Protected API routes below require the configured cookie/Access session;
// public auth, health and unsubscribe routes are mounted above.
// (FR-1.1) and the app-layer authorized-users check (FR-1.3).
const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use("*", requireAccessUser);
api.use("*", authenticatedRateLimit);

// docs/requirements/question-bank-management.md — Question Bank Management & Import (Admin).
api.route("/exams", examsRouter);
api.route("/providers", providersRouter);
api.route("/provider-icons", providerIconsRouter);
api.route("/exam-badges", examBadgesRouter);
api.route("/exams/:examId/questions", questionsRouter);
api.route("/exams/:examId/import", importsRouter);

// docs/requirements/practice-and-learning-modes.md — Practice Mode & Mock Exam Mode.
api.route("/exams/:examId/practice-catalog", practiceCatalogRouter);
api.route("/exams/:examId/attempts", examAttemptsRouter);
api.route("/attempts", attemptsRouter);
api.route("/questions/:questionId/bookmark", bookmarksRouter);
// docs/requirements/practice-and-learning-modes.md — Learning Mode (sequential read-through study). Its
// annotations/notes/AI-explanation display reuses the routers below
// unchanged (Learning Mode is a "review context" per FR-8.3/FR-11.6).
api.route("/exams/:examId/learning/progress", learningProgressRouter);
api.route("/questions/:questionId/learning-detail", learningDetailRouter);
// docs/requirements/review-notes-and-annotations.md — Wrong Question Book.
api.route("/questions/:questionId/wrong-book/mastered", wrongBookMasteredRouter);
// docs/requirements/review-notes-and-annotations.md — Annotation & Review.
api.route("/questions/:questionId/annotations", questionAnnotationsRouter);
api.route("/annotations", annotationsRouter);
api.route("/annotation-settings", annotationSettingsRouter);
// docs/requirements/review-notes-and-annotations.md — Question Notes (Personal & Shared).
api.route("/questions/:questionId/notes", questionNotesRouter);
api.route("/notes", notesRouter);
// implementation — Knowledge Points (personal Markdown notes, groups, tags,
// question links). The static /linkable-questions route is registered
// before the KP CRUD router's own "/:id" so it can never be captured as a
// knowledge point id.
api.route("/knowledge-points/linkable-questions", knowledgePointQuestionSearchRouter);
api.route("/knowledge-points", knowledgePointsRouter);
api.route("/knowledge-point-groups", knowledgePointGroupsRouter);
api.route("/knowledge-point-tags", knowledgePointTagsRouter);
api.route("/kp-images", kpImagesRouter);
api.route("/settings", settingsRouter);
api.route("/daily-email-settings", dailyEmailSettingsRouter);
// implementation — self-service MCP token lifecycle. /mcp-tokens is User MCP
// (any authenticated user manages their own); /admin/mcp-tokens is Admin
// MCP (requireAdmin, applied inside the factory).
api.route("/mcp-tokens", createMcpTokensRouter("user"));
// docs/requirements/authentication-and-users.md — User Profile (Display Name & Avatar).
api.route("/me", profileRouter);
api.route("/avatars", avatarsRouter);
// docs/requirements/statistics-and-progress.md — Personal Statistics Dashboard.
api.route("/exams/:examId/stats", examStatsRouter);
api.route("/exams/:examId/preferences", examPreferencesRouter);
api.route("/stats/activity", studyActivityRouter);
// docs/requirements/ai-explanations.md — AI Explanation Generation (BYOK AI-proxy endpoint).
api.route("/questions/:questionId/ai-explanations", questionAiExplanationsRouter);
api.route("/ai/generate", aiGenerateRouter);
// docs/requirements/question-bank-management.md — Admin Console (`/admin`): Authorized Users management,
// the usage overview and question-tag catalog. These routers are Admin-only (requireAdmin).
api.route("/admin/users", adminUsersRouter);
api.route("/admin/overview", adminOverviewRouter);
api.route("/admin/question-tags", questionTagsRouter);
api.route("/admin/mcp-tokens", createMcpTokensRouter("admin"));

app.route("/api", api);

export default {
  fetch: app.fetch,
  // wrangler.toml's [triggers] declares two cron schedules sharing this one
  // handler; branch on event.cron to route each to its job. Both run in the
  // background of the invocation that receives the scheduled event.
  scheduled: async (event, env, ctx) => {
    if (event.cron === "*/15 * * * *") {
      // implementation — daily question review email delivery.
      ctx.waitUntil(runDailyReviewEmailDelivery(env));
      return;
    }
    // implementation — daily sweep for abandoned Knowledge Point image uploads. A
    // failed/skipped run just means those rows are picked up on the next
    // day's sweep.
    ctx.waitUntil(runKnowledgePointImageCleanup(env));
    // Content mutation audit retention, on the same daily trigger and with the
    // same "a missed run is picked up tomorrow" property. Kept as its own
    // waitUntil so neither sweep's failure can cancel the other.
    ctx.waitUntil(runContentMutationAuditPrune(env));
  },
} satisfies ExportedHandler<Env>;
