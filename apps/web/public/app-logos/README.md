# Connected-app artwork

This is a deliberately small presentation-only registry. Logos are visual aids,
not verification or trust badges. Client names and complete client IDs remain
visible. No icon is fetched from a client-supplied URL or third-party host.

## Supported identities

All three fields must match: `clientKind: metadata_document`, the exact ID below,
and the published name. Missing/contradictory metadata, dynamic registration,
lookalike domains, query/fragment variants, and other names/IDs use the original
initial (`?` for blank names). Do not add broad substring or name-only matching.

| Name | Exact metadata-document client ID |
| --- | --- |
| ChatGPT | `https://chatgpt.com/oauth/client.json` |
| Codex | `https://chatgpt.com/oauth/codex/client.json` |

Both live metadata documents specify the same OpenAI blossom logo. Verified on
2026-10-19. Official references:
- https://developers.openai.com/plugins/build/auth
- https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/oauth_client_registration.rs

Callback-specific metadata URLs and Claude/dynamic registrations are not yet
mapped: add support only with a reliable identity rule and suitable reviewed
artwork. An unavailable local image falls back to the initial.

## Asset and usage

`openai.png` is the unchanged 512×512 transparent PNG published as `logo_uri` by
both metadata documents, downloaded from:
https://persistent.oaistatic.com/sonic/misc/openai-logo.png

OpenAI logo © OpenAI. Used solely to identify connected ChatGPT and Codex
applications. Use is subject to https://openai.com/brand/, not the repository's
code license. The asset is unmodified, decorative, and subordinate to the app's
visible name and connection details; its use does not imply endorsement.
It appears on a consistent white tile for legibility in every theme and status.
