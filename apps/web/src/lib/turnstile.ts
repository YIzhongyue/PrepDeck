// Cloudflare Turnstile in the browser (issue #82): loading Cloudflare's
// script, learning whether this deployment asks for human verification, and
// attaching a token to a protected request. The Worker verifies every token
// (apps/worker/src/lib/turnstile.ts); nothing here decides whether one is valid.

import { useCallback, useEffect, useState } from "react";
import { TURNSTILE_ERROR_CODE, TURNSTILE_TOKEN_HEADER, type TurnstileConfigResponse } from "@prepdeck/shared";
import { ApiError } from "./api";

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

/**
 * Whether this deployment asks for human verification. `failed` is not "off":
 * the answer is unknown, so protected actions wait for a retry rather than
 * going ahead without a token the Worker may require.
 */
export type TurnstileConfig =
  | { status: "loading" }
  | { status: "ready"; siteKey: string | null }
  | { status: "failed" };

let siteKeyPromise: Promise<string | null> | null = null;

function fetchSiteKey(): Promise<string | null> {
  if (siteKeyPromise) return siteKeyPromise;
  const pending = fetch("/api/auth/turnstile", { credentials: "include" })
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((body) => {
      const siteKey = body && typeof body === "object" ? (body as Partial<TurnstileConfigResponse>).siteKey : undefined;
      if (siteKey === null) return null;
      if (typeof siteKey === "string" && siteKey) return siteKey;
      throw new Error("Malformed Turnstile configuration");
    });
  siteKeyPromise = pending;
  // Only an answer is remembered; a failure is asked again.
  pending.catch(() => { if (siteKeyPromise === pending) siteKeyPromise = null; });
  return pending;
}

/**
 * The deployment's Turnstile configuration, looked up once `enabled`, and a
 * `reload` for when the lookup failed or the Worker refused a request for
 * want of verification the configuration said was off.
 */
export function useTurnstileConfig(enabled = true): { config: TurnstileConfig; reload: () => void } {
  const [config, setConfig] = useState<TurnstileConfig>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchSiteKey().then(
      (siteKey) => { if (active) setConfig({ status: "ready", siteKey }); },
      () => { if (active) setConfig({ status: "failed" }); },
    );
    return () => { active = false; };
  }, [enabled, attempt]);
  const reload = useCallback(() => {
    siteKeyPromise = null;
    setConfig({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { config, reload };
}

/** Whether `error` is the Worker refusing a request for want of verification. */
export function isHumanVerificationRefusal(error: unknown): boolean {
  return error instanceof ApiError && !!error.body && typeof error.body === "object"
    && (error.body as { code?: unknown }).code === TURNSTILE_ERROR_CODE;
}

/** The header that carries `token` on a protected fetch, or none without one. */
export function turnstileHeaders(token: string | null): Record<string, string> {
  return token ? { [TURNSTILE_TOKEN_HEADER]: token } : {};
}
