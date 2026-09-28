# Human verification (Turnstile)

[Documentation index](../README.md)

Captured on 2026-09-28 from the production web build, served under its content
security policy with a synthetic fixture API: one made-up account and one MCP
token. The widget is Cloudflare's real Turnstile, rendered with Cloudflare's
public test site keys, which is why it carries the red "For testing only"
label; a real site key shows no label. "Before" is the same build with no site
key, which renders exactly as `master` at `0345507`.
[FR-1.11](../requirements/authentication-and-users.md#fr-1-11) describes the
behavior.

| | Before | After |
|---|---|---|
| Login | ![Login before: the Google button alone](turnstile/login-off.png) | ![Login after: a passed Turnstile check above the Google button](turnstile/login-on.png) |
| Creating an MCP token | ![MCP token panel before: name, expiration and Create token](turnstile/mcp-create-off.png) | ![MCP token panel after: a passed check above Create token](turnstile/mcp-create.png) |

The Google button and Create token stay disabled until the check passes. In
Managed mode that is usually automatic, as above.

Rotating a token shows the check in the token's row, and rotation starts as
soon as it passes. This test key always asks for an interactive challenge:

![The desktop token's row asking to verify before rotating](turnstile/mcp-rotate.png)

When the session ends in use, the sign-in-again dialog asks for the same check:

![Your session has expired, with a passed check above Sign in again](turnstile/session-expired.png)

A refused or expired check returns to the login screen with a notice. Dusk gets
Turnstile's dark widget, and a card narrower than 300px its compact one; at
390px the flexible widget still fits:

<img src="turnstile/login-refused-dusk-phone.png" width="300" alt="Login at 390px in Dusk: the refusal notice above a dark Turnstile check">
