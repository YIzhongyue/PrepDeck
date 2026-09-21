// Order matters: Tailwind's layers come first so PrepDeck's unlayered token
// and component CSS keeps winning wherever the two overlap (implementation).
import "./styles/untitled-ui.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./lib/api";
import { PrepDeckProvider, usePrepDeck } from "./store/PrepDeckContext";
import { breakpointsFor } from "./lib/responsive";
import Login from "./screens/Login";
import Sidebar from "./components/Sidebar";
import WorkspaceLoading from "./components/WorkspaceLoading";
import TopBar from "./components/TopBar";
import TabBar, { MoreSheet } from "./components/TabBar";
import ConfirmDialog from "./components/ConfirmDialog";
import AnnotationToolbar from "./components/AnnotationToolbar";
import Dashboard from "./screens/Dashboard";
import PracticeSetup from "./screens/PracticeSetup";
import PracticeLive from "./screens/PracticeLive";
import MockSetup from "./screens/MockSetup";
import MockLive from "./screens/MockLive";
import MockResults from "./screens/MockResults";
import LearningSetup from "./screens/LearningSetup";
import LearningLive from "./screens/LearningLive";
import ListScreen from "./screens/ListScreen";
import Notes from "./screens/Notes";
import Admin from "./screens/Admin";
import PrivacyPolicy from "./screens/PrivacyPolicy";
import TermsOfService from "./screens/TermsOfService";
import { DEFAULT_THEME } from "./lib/themeStorage";

// implementation — code-split: react-markdown, mermaid, and @dnd-kit are sizable
// dependencies only this feature needs, so they load in their own chunk on
// first visit to Knowledge Points rather than bloating every screen's
// initial bundle.
const KnowledgePoints = lazy(() => import("./screens/KnowledgePoints"));

// implementation — Settings is the screen built on the shared Untitled UI
// primitives, so it is the only one that pulls in react-aria-components.
// Splitting it keeps that cost off every other screen's initial bundle, the
// same reasoning as Knowledge Points above.
const Settings = lazy(() => import("./screens/Settings"));

export function Shell() {
  const { state, width, curQ, mockQ, learningQ, retryWorkspace, dismissActionError } = usePrepDeck();
  const bp = breakpointsFor(width);
  // Measured height includes the bottom safe-area padding and text scaling.
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const compactNavigation = bp.narrow && !(state.screen === "learning" && width >= 768);
  const theme = state.theme || DEFAULT_THEME;

  const isDash = state.screen === "dash";
  const isSetup = state.screen === "practice" && state.pStage === "setup";
  const isLive = state.screen === "practice" && state.pStage === "live" && !!curQ();
  const isMockSetup = state.screen === "mock" && state.mStage === "setup";
  const isMockLive = state.screen === "mock" && state.mStage === "live" && !!mockQ();
  const isMockResults = state.screen === "mock" && state.mStage === "results";
  const isLearningSetup = state.screen === "learning" && state.lStage === "setup";
  const isLearningLive = state.screen === "learning" && state.lStage === "live" && !!learningQ();
  const isList = state.screen === "wrong" || state.screen === "bookmarks";
  const isNotes = state.screen === "notes";
  const isKnowledgePoints = state.screen === "knowledgePoints";
  const isSettings = state.screen === "settings";
  const isAdmin = state.screen === "admin";

  // The loading scene owns the viewport, outside the padded content column
  // and navigation. Keep independent screens available during exam refreshes.
  if (!isSettings && !isAdmin && !isKnowledgePoints && state.workspaceStatus === "loading") {
    return (
      <main data-pd-theme={theme} style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
        <WorkspaceLoading />
      </main>
    );
  }

  return (
    <div data-pd-theme={theme} style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
        <div inert={state.switching} style={{ display: "flex", alignItems: "stretch", flex: 1, minHeight: 0 }}>
          {!compactNavigation && <Sidebar rail={bp.rail} />}

          <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {compactNavigation && <TopBar />}

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingTop: bp.phone ? 18 : bp.narrow ? 22 : 30, paddingInline: bp.phone ? 16 : bp.narrow ? 22 : 34, paddingBottom: compactNavigation ? tabBarHeight + 20 : 40 }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", width: "100%", maxWidth: 1160, margin: "0 auto" }}>
                {state.workspaceNotice && <p role="status">{state.workspaceNotice}</p>}
                {state.actionError && <div role="alert" className="card" style={{ padding: 16, marginBottom: 16 }}>
                  <p>{state.actionError}</p><button className="btn btn-secondary" onClick={dismissActionError}>Dismiss</button>
                </div>}
                {!isSettings && !isAdmin && !isKnowledgePoints && state.workspaceStatus !== "ready" ? (
                  // Error/empty are short, self-contained states — center them in
                  // whatever height is actually left between the header and tab bar instead
                  // of a fixed-size box that strands empty space below it on tall phones.
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div className="card" style={{ padding: 24 }} role={state.workspaceStatus === "error" ? "alert" : "status"}>
                      <p>{state.workspaceStatus === "error" ? state.workspaceError : "No exams are available yet. Ask an administrator to add an exam."}</p>
                      {state.workspaceStatus === "error" && <button className="btn btn-primary" onClick={retryWorkspace}>Retry</button>}
                    </div>
                  </div>
                ) : (
                  <>
                    {state.workspaceStatus === "ready" && <div key={state.workspaceGeneration}>
                    {isDash && <Dashboard />}
                    {isSetup && <PracticeSetup bp={bp} />}
                    {isLive && <PracticeLive bp={bp} />}
                    {isMockSetup && <MockSetup bp={bp} />}
                    {isMockLive && <MockLive bp={bp} />}
                    {isMockResults && <MockResults />}
                    {isLearningSetup && <LearningSetup bp={bp} />}
                    {isLearningLive && <LearningLive bp={bp} />}
                    {isList && <ListScreen bp={bp} />}
                    {isNotes && <Notes />}
                    </div>}
                    {isKnowledgePoints && (
                      <Suspense fallback={<p style={{ opacity: 0.5 }}>Loading…</p>}>
                        <KnowledgePoints bp={bp} />
                      </Suspense>
                    )}
                    {isSettings && (
                      <Suspense fallback={<p style={{ opacity: 0.5 }}>Loading…</p>}>
                        <Settings bp={bp} />
                      </Suspense>
                    )}
                    {isAdmin && <Admin bp={bp} />}
                  </>
                )}
              </div>
            </div>
          </main>
        </div>

        {state.switching && <div role="status" aria-live="polite" className="dialog-backdrop" style={{ zIndex: 200 }}>
          <div className="card" style={{ padding: 24 }}>Saving your work before switching…</div>
        </div>}
        {compactNavigation && <TabBar onHeightChange={setTabBarHeight} />}
        <MoreSheet />
        <ConfirmDialog />
        <AnnotationToolbar />
      </div>
    </div>
  );
}

// Gates the app behind a real session. Google sign-in (docs/requirements/authentication-and-users.md) is a
// full-page round trip through the Worker (routes/auth.ts's /google/start
// and /google/callback), not a fetch — so its outcome arrives as a
// `?auth=` query param on the redirect back here, not as component state.
// Absent that, /api/auth/me (gated by the same middleware as every other
// route) tells us whether an existing session cookie is still valid; a 403
// there means "has a session, but got revoked since" — the same "denied"
// state as a fresh sign-in that isn't on the Authorized Users list (FR-1.3).
// `conflict` is its own state: the address *is* on the list, but bound to a
// different Google account (FR-1.9), which needs an Admin to clear rather
// than another invitation.
type Gate =
  | { kind: "loading" }
  | { kind: "authed" }
  | { kind: "denied"; email: string | null; conflict?: boolean }
  | { kind: "signin"; signedOut?: boolean; error?: boolean };

function readAuthParam(): { kind: "denied"; email: string | null; conflict?: boolean } | { kind: "signin"; signedOut?: boolean; error?: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("auth");
  if (!auth) return null;

  window.history.replaceState(null, "", window.location.pathname);
  if (auth === "denied") return { kind: "denied", email: params.get("email") };
  if (auth === "conflict") return { kind: "denied", email: params.get("email"), conflict: true };
  if (auth === "signedout") return { kind: "signin", signedOut: true };
  if (auth === "error") return { kind: "signin", error: true };
  return null;
}

function AuthenticatedApp() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  // readAuthParam() strips the `?auth=` param as a side effect — it must run,
  // and be acted on, at most once. Without this guard, React.StrictMode's
  // dev-only double effect invocation (main.tsx) runs this effect twice: the
  // first call consumes and strips the param and sets the gate from it; the
  // second call must not re-derive it (the param is gone from the URL by
  // then) *or* fall through to /api/auth/me — either would silently
  // overwrite the denied/error/signedOut state the first call just set.
  const authParamResult = useRef<ReturnType<typeof readAuthParam> | undefined>(undefined);

  useEffect(() => {
    if (authParamResult.current === undefined) {
      authParamResult.current = readAuthParam();
    }
    if (authParamResult.current) {
      setGate(authParamResult.current);
      return;
    }

    apiFetch("/api/auth/me")
      .then(() => setGate({ kind: "authed" }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          const email = err.body && typeof err.body === "object" && "email" in err.body ? (err.body as { email: unknown }).email : null;
          setGate({ kind: "denied", email: typeof email === "string" ? email : null });
        } else {
          setGate({ kind: "signin" });
        }
      });
  }, []);

  if (gate.kind === "loading") return null;
  if (gate.kind === "denied") return <Login deniedEmail={gate.email} conflict={gate.conflict} />;
  if (gate.kind === "signin") return <Login signedOut={gate.signedOut} error={gate.error} />;

  return (
    <PrepDeckProvider>
      <Shell />
    </PrepDeckProvider>
  );
}

export default function App() {
  const publicPath = window.location.pathname.replace(/\/$/, "");
  if (publicPath === "/privacy") {
    return <PrivacyPolicy />;
  }
  if (publicPath === "/terms") {
    return <TermsOfService />;
  }

  return <AuthenticatedApp />;
}
