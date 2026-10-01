// issue #41 — the URL reflects where the learner is, so Back/Forward move between
// PrepDeck screens, a reload restores the screen, exam and Learning position,
// and a Learning question or a Knowledge Point can be linked to.
//
// The store keeps navigation as state (screen, stages, the Learning queue); this
// module only maps that state to a path and a path back to a navigation intent.
// It is pure so both directions can be tested without a browser.
//
//   /exams/:slug                         Statistics
//   /exams/:slug/learning[/:sequence]    Learning setup, or the question with that sequence number
//   /exams/:slug/practice | /mock        Practice and Mock (their stages stay out of the URL)
//   /exams/:slug/bookmarks | /wrong | /annotations
//   /knowledge-points[/:id]              Knowledge Points list, or one note
//   /settings, /admin
//   /connect?request=…                    MCP OAuth consent (issue #102; App.tsx, outside the store)
//
// Exam screens carry the exam's slug, so Back across an exam switch switches
// back. Knowledge Points, Settings and Admin belong to the account.

import type { PracticeSource } from "../store/PrepDeckContext";
import type { ScreenId } from "../types";

export interface Route {
  screen: ScreenId;
  examSlug: string | null;
  /** Learning: the question's sequence number; null for the setup screen. */
  learningSequence: number | null;
  /** Knowledge Points: the open note; null for the list. */
  knowledgePointId: string | null;
}

/** What a URL asks for. Old email links may name a question by id and a practice source. */
export interface RouteIntent extends Route {
  /** The daily review email's legacy "/learning/exam?exam=&question_id=" link. */
  questionId: string | null;
  source: PracticeSource | null;
  /** True when the URL is an old or non-canonical spelling to be replaced. */
  legacy: boolean;
}

const EXAM_SCREEN_SEGMENTS: Partial<Record<ScreenId, string>> = {
  dash: "",
  learning: "learning",
  practice: "practice",
  mock: "mock",
  bookmarks: "bookmarks",
  wrong: "wrong",
  notes: "annotations",
};
const ACCOUNT_SCREEN_PATHS: Partial<Record<ScreenId, string>> = {
  knowledgePoints: "/knowledge-points",
  settings: "/settings",
  admin: "/admin",
};

/** First path segments the SPA owns. None may be served by the Worker first (wrangler.toml). */
export const SPA_ROUTE_PREFIXES = ["exams", "knowledge-points", "settings", "admin", "learning", "privacy", "terms", "connect"] as const;

const KNOWN_SCREENS: readonly ScreenId[] = ["dash", "practice", "mock", "learning", "wrong", "bookmarks", "notes", "knowledgePoints", "settings", "admin"];
const KNOWN_SOURCES: readonly PracticeSource[] = ["all", "new", "wrong", "bm", "focus"];

export function isExamScreen(screen: ScreenId): boolean {
  return EXAM_SCREEN_SEGMENTS[screen] !== undefined;
}

/** The canonical path for a route. An exam screen without an exam is "/". */
export function routePath(route: Route): string {
  const account = ACCOUNT_SCREEN_PATHS[route.screen];
  if (account) {
    return route.screen === "knowledgePoints" && route.knowledgePointId
      ? `${account}/${encodeURIComponent(route.knowledgePointId)}`
      : account;
  }
  if (!route.examSlug) return "/";
  const base = `/exams/${encodeURIComponent(route.examSlug)}`;
  const segment = EXAM_SCREEN_SEGMENTS[route.screen] ?? "";
  if (!segment) return base;
  if (route.screen === "learning" && route.learningSequence != null) return `${base}/learning/${route.learningSequence}`;
  return `${base}/${segment}`;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function intent(route: Partial<RouteIntent> & Pick<Route, "screen">): RouteIntent {
  return { examSlug: null, learningSequence: null, knowledgePointId: null, questionId: null, source: null, legacy: false, ...route };
}

/**
 * What `pathname` and `search` ask for, or null for "/" and for anything this
 * app does not know (which then opens the default screen).
 */
export function parseRoute(pathname: string, search = ""): RouteIntent | null {
  const params = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean).map(decode);
  if (segments.some((s) => s === null)) return null;
  const [first, second, third, fourth, ...rest] = segments as string[];

  // Links written before routing existed: "/?screen=wrong&source=wrong", and
  // the daily review email's "/learning/exam?exam=<slug>&question_id=<id>".
  if (!first) {
    const screen = params.get("screen");
    const source = params.get("source");
    const knownSource = source && (KNOWN_SOURCES as string[]).includes(source) ? (source as PracticeSource) : null;
    if (screen && (KNOWN_SCREENS as string[]).includes(screen)) return intent({ screen: screen as ScreenId, source: knownSource, legacy: true });
    if (knownSource) return intent({ screen: "practice", source: knownSource, legacy: true });
    return null;
  }
  if (first === "learning" && second === "exam" && !third) {
    const examSlug = params.get("exam");
    const questionId = params.get("question_id");
    return examSlug && questionId ? intent({ screen: "learning", examSlug, questionId, legacy: true }) : null;
  }

  if (first === "exams" && second) {
    if (rest.length) return null;
    if (third === undefined) return intent({ screen: "dash", examSlug: second });
    const screen = (Object.keys(EXAM_SCREEN_SEGMENTS) as ScreenId[]).find((id) => EXAM_SCREEN_SEGMENTS[id] === third && third !== "");
    if (!screen) return null;
    if (fourth === undefined) return intent({ screen, examSlug: second });
    if (screen !== "learning" || !/^[1-9]\d{0,8}$/.test(fourth)) return null;
    return intent({ screen, examSlug: second, learningSequence: Number(fourth) });
  }

  const account = (Object.keys(ACCOUNT_SCREEN_PATHS) as ScreenId[]).find((id) => ACCOUNT_SCREEN_PATHS[id] === `/${first}`);
  if (!account || third !== undefined) return null;
  if (second === undefined) return intent({ screen: account });
  return account === "knowledgePoints" ? intent({ screen: account, knowledgePointId: second }) : null;
}

const SCREEN_TITLES: Record<ScreenId, string> = {
  dash: "Statistics",
  learning: "Learning",
  practice: "Practice",
  mock: "Mock exam",
  bookmarks: "Bookmarks",
  wrong: "Wrong questions",
  notes: "Annotations",
  knowledgePoints: "Knowledge points",
  settings: "Settings",
  admin: "Admin",
};

/** The tab title for a route: "Learning #57 · Cloud Pro · PrepDeck". */
export function routeTitle(route: Route, examName: string | null): string {
  let screen = SCREEN_TITLES[route.screen];
  if (route.screen === "learning" && route.learningSequence != null) screen = `${screen} #${route.learningSequence}`;
  const parts = [screen];
  if (examName && isExamScreen(route.screen)) parts.push(examName);
  parts.push("PrepDeck");
  return parts.join(" · ");
}
