// Starting Google sign-in from the login screen or the session-expired dialog.
// When the deployment uses Turnstile (issue #82), the Worker will not start
// sign-in without a verified token, so the caller renders a TurnstileWidget
// with `siteKey`/`widgetKey`/`onToken` and the button waits for `ready`.

import { useEffect, useState } from "react";
import { submitSignIn } from "./reauth";
import { useTurnstileSiteKey } from "./turnstile";

/** `enabled` defers the site key lookup until sign-in is actually on offer. */
export function useGoogleSignIn(enabled = true) {
  const siteKey = useTurnstileSiteKey(enabled);
  const [token, setToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Coming back from Google restores this page from the back/forward cache
    // exactly as it was left: still busy, and holding a token that the Worker
    // has already spent. Start over with a fresh widget.
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setBusy(false);
      setToken(null);
      setWidgetKey((key) => key + 1);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  // Unknown (still loading) waits; no site key needs no token.
  const ready = siteKey === null || (!!siteKey && !!token);

  const signIn = (returnTo: string) => {
    if (!ready || busy) return;
    setBusy(true);
    submitSignIn(returnTo, token);
  };

  return { siteKey, widgetKey, onToken: setToken, ready, busy, signIn };
}
