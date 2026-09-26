import { useEffect, useState } from "react";
import { SESSION_EXPIRED_EVENT, resetSessionLoss } from "../lib/api";
import { signInUrl } from "../lib/reauth";
import { usePrepDeck } from "../store/PrepDeckContext";
import ModalLayer from "./ModalLayer";

// Shown the first time any request finds the session gone (issue #52): a
// 7-day session running out in an open tab, or a sign-out on another device.
// Every action would otherwise fail with its own "please retry" message, and
// retrying can never succeed until the learner signs in again.
export default function SessionExpiredDialog() {
  const { state, preserveForReauth } = usePrepDeck();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, show);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, show);
  }, []);

  if (!open) return null;
  const inMock = state.mStage === "live" && !!state.mockAttemptId;

  const signIn = () => {
    setLeaving(true);
    preserveForReauth();
    // Back to the mock when one is running, so its answers are restored on resume.
    window.location.assign(signInUrl(inMock ? "/?screen=mock" : undefined));
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
