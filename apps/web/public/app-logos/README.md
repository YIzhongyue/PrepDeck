# Connected-app artwork

This is a deliberately small presentation-only registry. Logos are visual aids,
not verification or trust badges. Client names and complete client IDs remain
visible. No icon is fetched from a client-supplied URL or third-party host.

## Supported identities

All three fields must match: `clientKind: metadata_document`, the exact ID below,
and the published name. Missing/contradictory metadata, dynamic registration,
lookalike domains, query/fragment variants, and other names/IDs use the original
initial (`?` for blank names). Do not add broad substring or name-only matching.

| Name | Exact metadata-document client ID | Artwork |
| --- | --- | --- |
| ChatGPT | `https://chatgpt.com/oauth/client.json` | `openai.png` |
| Codex | `https://chatgpt.com/oauth/codex/client.json` | `openai.png` |
| Claude | `https://claude.ai/oauth/mcp-oauth-client-metadata` | `claude.svg` |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `claude.svg` |
| Visual Studio Code | `https://vscode.dev/oauth/client-metadata.json` | `vscode.png` |
| Visual Studio Code | `https://insiders.vscode.dev/oauth/client-metadata.json` | `vscode.png` |
| GitHub Copilot CLI | `https://github.com/copilot/cli/client-metadata.json` | `github-copilot.svg` |

Each ID and name was read from the live metadata document on 2026-10-19.
"Claude" is the shared client of claude.ai, Claude Desktop, mobile and Cowork.
GitHub Copilot in VS Code connects as Visual Studio Code (stable and Insiders
both publish that name), so it shows the VS Code logo. Official references:
- https://developers.openai.com/plugins/build/auth
- https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/oauth_client_registration.rs
- https://claude.com/docs/connectors/building/authentication
- https://github.com/github/copilot-cli/issues/1305

Not mapped: callback-specific metadata URL variants, and every dynamically
registered client. Cursor, for example, only uses dynamic registration, so its
`client_id` is PrepDeck-issued and its name is self-asserted; it keeps its
initial until it publishes a metadata document. Add support only with a
reliable identity rule and suitable reviewed artwork. An unavailable local image
falls back to the initial.

## Asset and usage

Every file is unmodified, downloaded on 2026-10-19 from the vendor's own host:

| File | Source |
| --- | --- |
| `openai.png` | https://persistent.oaistatic.com/sonic/misc/openai-logo.png (512×512 PNG, the `logo_uri` of both OpenAI metadata documents) |
| `claude.svg` | https://claude.ai/favicon.svg (the Claude spark; neither Claude document declares a `logo_uri`) |
| `vscode.png` | https://code.visualstudio.com/assets/branding/code-stable.png (1024×1024 PNG, the `logo_uri` of both VS Code metadata documents) |
| `github-copilot.svg` | https://github.com/primer/octicons/blob/main/icons/copilot-24.svg (GitHub's Copilot icon drawn for 24px, the tile's size; the Copilot CLI document declares no `logo_uri`) |

OpenAI logo © OpenAI, subject to https://openai.com/brand/. Claude logo ©
Anthropic. Visual Studio Code logo © Microsoft, subject to
https://code.visualstudio.com/brand. GitHub Copilot icon © GitHub, from Primer
Octicons (MIT, Copyright (c) 2026 GitHub Inc.). The complete upstream copyright
and permission notice is retained in [github-copilot.LICENSE.txt](./github-copilot.LICENSE.txt)
and distributed alongside the SVG in the web build. Upstream license:
https://github.com/primer/octicons/blob/main/LICENSE. The Copilot name and mark remain subject to
https://brand.github.com/. None of these is covered by the repository's code
license. Each is used solely to identify the matching connected application,
is decorative, and stays subordinate to the app's visible name and connection
details; its use does not imply endorsement. Logos appear on a consistent white
tile for legibility in every theme and status.
