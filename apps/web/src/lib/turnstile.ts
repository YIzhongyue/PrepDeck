// Cloudflare Turnstile in the browser (issue #82): loading Cloudflare's
// script, learning whether this deployment asks for human verification, and
// attaching a token to a protected request. The Worker verifies every token
// (apps/worker/src/lib/turnstile.ts); nothing here decides whether one is valid.

import { useEffect, useState } from "react";
import { TURNSTILE_TOKEN_HEADER, type TurnstileConfigResponse } from "@prepdeck/shared";

// Must be loaded from this exact URL: Cloudflare updates it in place, and a
// copy or proxy breaks the widget.
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme: "light" | "dark";
  size: "flexible" | "compact";
  "response-field": boolean;
  "refresh-expired": "auto";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": (code: string) => boolean | void;
  "timeout-callback": () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Cloudflare's widget API, loaded once per page. A failed load can be retried. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not initialise")));
    script.onerror = () => reject(new Error("Turnstile could not be loaded"));
    document.head.append(script);
  }).catch((error: unknown) => {
    scriptPromise = null;
    document.querySelector(`script[src="${SCRIPT_URL}"]`)?.remove();
    throw error;
  });
  return scriptPromise;
}

let siteKeyPromise: Promise<string | null> | null = null;

function fetchSiteKey(): Promise<string | null> {
  siteKeyPromise ??= fetch("/api/auth/turnstile", { credentials: "include" })
    .then((res) => (res.ok ? (res.json() as Promise<Partial<TurnstileConfigResponse>>) : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((body) => (typeof body.siteKey === "string" && body.siteKey ? body.siteKey : null))
    .catch(() => {
      // Unknown is treated as "not required": the Worker still refuses an
      // unverified request, with a message saying so. The next mount asks again.
      siteKeyPromise = null;
      return null;
    });
  return siteKeyPromise;
}

/**
 * The deployment's Turnstile site key: `undefined` while it is being looked
 * up (or until `enabled`), `null` when requests need no verification.
 */
export function useTurnstileSiteKey(enabled = true): string | null | undefined {
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchSiteKey().then((key) => { if (active) setSiteKey(key); });
    return () => { active = false; };
  }, [enabled]);
  return siteKey;
}

/** The header that carries `token` on a protected fetch, or none without one. */
export function turnstileHeaders(token: string | null): Record<string, string> {
  return token ? { [TURNSTILE_TOKEN_HEADER]: token } : {};
}
