import { useEffect, useState } from "react";
import { SESSION_EXPIRED_EVENT, isSessionExpiryPending, resetSessionLoss } from "../lib/api";
import { signInUrl } from "../lib/reauth";
import { routePath } from "../lib/routes";
import { usePrepDeck } from "../store/PrepDeckContext";
import ModalLayer from "./ModalLayer";

// Shown the first time any request finds the session gone (issue #52): a
// 7-day session running out in an open tab, or a sign-out on another device.
// Every action would otherwise fail with its own "please retry" message, and
// retrying can never succeed until the learner signs in again.
export default function SessionExpiredDialog() {
  const { state, preserveForReauth } = usePrepDeck();
  // The Shell mounts one of these in its loading layout and one in its normal
  // layout. A refused request can announce the loss to the first and then, by
  // failing, swap in the second, so a newly mounted dialog starts from the
  // announced state instead of waiting for an event that already fired.
  const [open, setOpen] = useState(isSessionExpiryPending);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, show);
    // Covers an announcement between the first render and this subscription.
    if (isSessionExpiryPending()) setOpen(true);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, show);
  }, []);

  if (!open) return null;
  const inMock = state.mStage === "live" && !!state.mockAttemptId;

  const signIn = () => {
    setLeaving(true);
    preserveForReauth();
    // Back to the mock when one is running, so its answers are restored on
    // resume; otherwise to this page, whose address names it (issue #41).
    const examSlug = state.exams.find((e) => e.id === state.examId)?.slug ?? null;
    window.location.assign(signInUrl(inMock ? routePath({ screen: "mock", examSlug, learningSequence: null, knowledgePointId: null }) : undefined));
  };
  // Staying keeps the page readable; the next refused request asks again.
  const stay = () => {
    resetSessionLoss();
    setOpen(false);
  };

  return (
    <ModalLayer labelledBy="session-expired-title" onClose={stay}>
      <div className="dialog">
        <h2 id="session-expired-title" className="dialog-title" style={{ margin: 0 }}>Your session has expired</h2>
        <p id="session-expired-body" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Sign in again to continue. Everything already saved is kept
          {inMock ? ", and your mock answers that could not be saved are restored when you resume the exam. Its timer keeps running." : "."}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={stay}>Not now</button>
          <button type="button" className="btn btn-primary" onClick={signIn} disabled={leaving}>Sign in again</button>
        </div>
      </div>
    </ModalLayer>
  );
}
