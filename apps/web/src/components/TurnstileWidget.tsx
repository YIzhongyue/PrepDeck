// Cloudflare Turnstile widget (issue #82), for any request the Worker gates
// on human verification. Rendered explicitly so its token is reported to the
// parent rather than injected into a form, and so its lifecycle follows the
// component's. Use it only where a request needs it, never on every page.
//
// Tokens are single-use and expire after five minutes. An expired token is
// refreshed automatically. After a request spends one, whatever the outcome,
// give the widget a new `key` so it mounts afresh with a new token.

import { useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@prepdeck/shared";
import { loadTurnstile, type TurnstileApi } from "../lib/turnstile";
import "./TurnstileWidget.css";

type Phase = "loading" | "ready" | "verified" | "expired" | "failed" | "unavailable";

const MESSAGES: Record<Phase, string> = {
  loading: "Loading the verification check…",
  ready: "",
  verified: "",
  expired: "The verification expired. Refreshing it…",
  failed: "The verification check didn't complete.",
  unavailable: "The verification check couldn't load. Check your connection.",
};

// The flexible widget needs 300px; narrower cards get the compact one.
const FLEXIBLE_MIN_WIDTH = 300;

// Dusk is the one dark scheme (public/theme-init.js sets the attribute).
function widgetTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-pd-theme") === "dusk" ? "dark" : "light";
}

export default function TurnstileWidget({ siteKey, action, onTokenChange }: {
  siteKey: string;
  /** The protected surface; the Worker refuses a token solved for another. */
  action: TurnstileAction;
  /** A fresh token, or null once there is none to send (expired, failed, unmounted). */
  onTokenChange: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const [phase, setPhase] = useState<Phase>("loading");
  // Bumped to try loading Cloudflare's script again after it failed.
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  });

  useEffect(() => {
    let active = true;
    const report = (token: string | null) => { if (active) onTokenChangeRef.current(token); };
    loadTurnstile().then((api) => {
      const container = containerRef.current;
      if (!active || !container) return;
      const id = api.render(container, {
        sitekey: siteKey,
        action,
        theme: widgetTheme(),
        size: container.clientWidth < FLEXIBLE_MIN_WIDTH ? "compact" : "flexible",
        "response-field": false,
        "refresh-expired": "auto",
        callback: (token) => { setPhase("verified"); report(token); },
        "expired-callback": () => { setPhase("expired"); report(null); },
        // Handled here: Turnstile retries what it can by itself, and the
        // message below offers a manual retry for the rest.
        "error-callback": () => { setPhase("failed"); report(null); return true; },
        "timeout-callback": () => { setPhase("failed"); report(null); },
      });
      if (!id) { setPhase("failed"); return; }
      widgetRef.current = { api, id };
      setPhase("ready");
    }, () => { if (active) setPhase("unavailable"); });

    return () => {
      // The token dies with its widget, so the parent must not keep sending it.
      onTokenChangeRef.current(null);
      active = false;
      const widget = widgetRef.current;
      widgetRef.current = null;
      if (widget) widget.api.remove(widget.id);
    };
  }, [siteKey, action, loadAttempt]);

  const retry = () => {
    if (phase === "unavailable") {
      setPhase("loading");
      setLoadAttempt((n) => n + 1);
      return;
    }
    const widget = widgetRef.current;
    if (!widget) return;
    widget.api.reset(widget.id);
    setPhase("ready");
  };

  const problem = phase === "failed" || phase === "unavailable";
  return (
    <div className="turnstile" data-phase={phase}>
      {/* Cloudflare puts its iframe in a closed shadow root, out of reach of
          anything that lists focusable elements. `data-focus-region` tells
          ModalLayer's focus trap it is there; focusing this box puts the next
          Tab inside it. */}
      <div ref={containerRef} className="turnstile-widget" data-focus-region="" tabIndex={-1} role="group" aria-label="Human verification" />
      <div className="turnstile-status">
        <p role="status" aria-live="polite" className={problem ? "turnstile-problem" : undefined}>{MESSAGES[phase]}</p>
        {problem && <button type="button" className="turnstile-retry" onClick={retry}>Try again</button>}
      </div>
    </div>
  );
}

/**
 * In place of the widget while the deployment's verification setting could not
 * be looked up. The protected action stays disabled until a retry succeeds.
 */
export function TurnstileConfigError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="turnstile" data-phase="unavailable">
      <div className="turnstile-status">
        <p role="alert" className="turnstile-problem">Couldn&apos;t check whether human verification is needed. Check your connection.</p>
        <button type="button" className="turnstile-retry" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}
