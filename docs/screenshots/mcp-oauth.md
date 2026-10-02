# MCP OAuth consent and connected apps

[Documentation index](../README.md)

Captured on 2026-10-01 from the real components with synthetic fixture data (one
made-up account, client and connection); no deployment was contacted.
[FR-1.12](../requirements/authentication-and-users.md#fr-1-12) and
[MCP architecture](../architecture/mcp.md#oauth-authorization-issue-102) describe
the behavior. These screens are new; there is no "before".

The consent screen an OAuth-capable MCP client opens (`/connect`), after the
ordinary Google sign-in. The app's name is self-asserted and marked unverified;
the screen shows where the browser returns, which MCP server, each permission
and the signed-in account:

![Consent screen on desktop: Connect Claude Desktop to PrepDeck?](mcp-oauth/consent-desktop.png)

At phone width:

![Consent screen at 360px](mcp-oauth/consent-phone.png)

An Admin MCP request seen by an account that is not an active administrator
offers no approval, only a way back to the app:

![Administrator access required](mcp-oauth/consent-admin.png)

Settings → AI & integrations: connected apps sit next to, and apart from, the
personal access tokens, and can be disconnected. The Admin console shows the
same card for Admin MCP connections.

![MCP access tokens card above the Connected apps card](mcp-oauth/settings-connected-apps.png)
