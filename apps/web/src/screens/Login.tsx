import { useState } from "react";
import type { CSSProperties } from "react";
import BrandLogo from "../components/BrandLogo";

interface LoginProps {
  /** Set when a Google account signed in successfully but isn't on the
   * Authorized Users list (or was revoked) — FR-1.3. */
  deniedEmail?: string | null;
  /** The address is on the Authorized Users list, but bound to a different Google account (FR-1.9). */
  conflict?: boolean;
  /** Just came back from Sign Out. */
  signedOut?: boolean;
  /** The OAuth round trip didn't complete (bad state, token exchange failed). */
  error?: boolean;
}

function GoogleIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84a10.13 10.13 0 0 1-4.4 6.65v5.52h7.1c4.16-3.83 6.58-9.47 6.58-16.18z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.32l-7.1-5.52c-1.97 1.32-4.49 2.1-7.46 2.1-5.74 0-10.6-3.88-12.33-9.09H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.67 28.17A13.2 13.2 0 0 1 10.98 24c0-1.45.25-2.86.69-4.17v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.87l7.33-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.3-6.3C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.13l7.33 5.7c1.73-5.21 6.59-9.08 12.33-9.08z" />
    </svg>
  );
}

function LockIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      <rect x={3} y={11} width={18} height={11} rx={2} />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// The mascot pose crests the top edge of the sign-in card (Login Redesign,
// Turn 1a): books for the sign-in states, a padlock once access is refused.
const MASCOT = {
  signin: { src: "/mascot/3D-Chibi/normal.png", alt: "PrepDeck mascot holding a stack of books" },
  denied: { src: "/mascot/3D-Chibi/unauthorized.png", alt: "PrepDeck mascot holding a padlock, looking apologetic" },
};

// The card carries the page's only heading. The redesign sets it below the
// global h1 scale, so the size is given here rather than by the token sheet.
const headingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontWeight: "var(--font-heading-weight)" as unknown as number,
  fontSize: "clamp(25px, 3.2vw, 32px)",
  lineHeight: 1.12,
  letterSpacing: "-0.015em",
};

// Shared by the signed-out and OAuth-error notices; the card centres its text,
// so both opt back into a left-aligned reading line.
const noticeStyle: CSSProperties = {
  display: "flex",
  gap: 8.8,
  padding: "11px 15px",
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: "left",
};

// docs/requirements/authentication-and-users.md — the sign-in screen. Google is the only sign-in method
// (FR-1.1): the button below navigates the whole page to
// GET /api/auth/google/start, which redirects to Google and, on return,
// either lands the user in the app or bounces back here with `?auth=denied`
// / `?auth=error` (see routes/auth.ts and App.tsx, which parses those into
// the props below).
export default function Login({ deniedEmail, conflict, signedOut, error }: LoginProps) {
  const [busy, setBusy] = useState(false);
  const denied = deniedEmail !== undefined && deniedEmail !== null;
  const mascot = denied ? MASCOT.denied : MASCOT.signin;

  const signIn = () => {
    setBusy(true);
    window.location.href = "/api/auth/google/start";
  };

  return (
    <div className="login-page">
      <div className="login-grid" aria-hidden="true" />
      <BrandLogo className="login-brand" />

      <div className="login-content">
        <img key={mascot.src} className="login-mascot" src={mascot.src} alt={mascot.alt} />

        <div className="login-card">
          {denied ? (
            <div className="login-fade" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 15, width: "100%" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: 999, background: "var(--color-accent-100)", color: "var(--color-accent-800)", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>
                <LockIcon size={14} />
                {conflict ? "Already linked" : "Invite only"}
              </span>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h1 style={headingStyle}>{conflict ? "Linked to another account" : "Access not authorized"}</h1>
                <p style={{ margin: 0, fontSize: 14, color: "var(--color-neutral-700)" }}>
                  {conflict
                    ? "This address is authorized, but it's already linked to a different Google account — so signing in with this one would have adopted someone else's data. Ask an admin to reset its Google link from Authorized Users, then sign in again."
                    : "You signed in successfully, but this account isn't on PrepDeck's authorized list. Ask an admin to invite it, then try again."}
                </p>
              </div>

              {deniedEmail && (
                <div style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "12px 16px", borderRadius: 999, background: "var(--color-surface)", border: "1px solid var(--color-divider)" }}>
                  <span style={{ display: "grid", placeItems: "center", flex: "none", width: 32, height: 32, borderRadius: "50%", background: "var(--color-accent-200)", color: "var(--color-accent-800)", fontSize: 13, fontWeight: 700 }}>
                    {deniedEmail.charAt(0).toUpperCase()}
                  </span>
                  <span style={{ minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deniedEmail}</span>
                </div>
              )}

              <button type="button" className="btn btn-primary login-primary-btn" style={{ width: "100%", minHeight: 52, padding: "8.8px 17.6px", fontSize: 15, boxShadow: "0 8px 22px color-mix(in srgb, var(--color-accent) 24%, transparent)" }} onClick={signIn}>
                Try a different account
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)", width: "100%" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h1 style={headingStyle}>Welcome back!</h1>
                <p style={{ margin: 0, fontSize: 14.5, color: "var(--color-neutral-700)" }}>
                  Every practice question, one deck. Sign in to start practicing or pick up where you left off.
                </p>
              </div>

              {signedOut && (
                <div className="login-fade" style={{ ...noticeStyle, alignItems: "center", borderRadius: 999, background: "var(--color-neutral-200)", color: "var(--color-neutral-800)" }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  <span>You've been signed out. Sign in again to pick up where you left off.</span>
                </div>
              )}

              {error && (
                <div role="alert" className="login-fade" style={{ ...noticeStyle, alignItems: "flex-start", borderRadius: 22, background: "var(--color-mark-1)", color: "var(--color-mark-1-text)" }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 2 }}>
                    <circle cx={12} cy={12} r={9} />
                    <path d="M12 8v4" />
                    <path d="M12 16h.01" />
                  </svg>
                  <span>Google sign-in didn't complete. Check your connection and try again — nothing was submitted.</span>
                </div>
              )}

              <button
                type="button"
                onClick={signIn}
                disabled={busy}
                className="btn login-google-btn"
                style={{ width: "100%", minHeight: 52, gap: 11, padding: "8.8px 16px", fontSize: 15, background: "var(--color-bg)", border: "1px solid var(--color-divider)", boxShadow: "var(--pd-shadow-sm)", cursor: busy ? "default" : "pointer" }}
              >
                {busy ? (
                  <span style={{ width: 18, height: 18, flex: "none", borderRadius: "50%", border: "2px solid var(--color-divider)", borderTopColor: "var(--color-accent)", animation: "pd-spin 700ms linear infinite" }} />
                ) : (
                  <GoogleIcon />
                )}
                <span style={{ fontFamily: "var(--font-body)", fontWeight: 600 }}>{busy ? "Signing in…" : "Sign in with Google"}</span>
              </button>

              <p style={{ margin: 0, maxWidth: 340, fontSize: 12, fontWeight: 300, lineHeight: 1.5, color: "var(--color-neutral-700)" }}>
                Access is by invitation only. Use the Google account your admin has approved, or contact them to request access.
              </p>
            </div>
          )}

          <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <hr className="hr" style={{ width: "100%", margin: 0 }} />
            <div style={{ display: "flex", gap: 16, fontSize: 12, fontWeight: 600 }}>
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
