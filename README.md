![PrepDeck](/imgs/PrepDeck-horizontal-logo-blue.png)

[![CI](https://github.com/YIzhongyue/PrepDeck/actions/workflows/ci.yml/badge.svg)](https://github.com/YIzhongyue/PrepDeck/actions/workflows/ci.yml) [![M8ven Score](https://m8ven.ai/badge/mcp/yizhongyue-prepdeck-0kh85z)](https://m8ven.ai/mcp/yizhongyue-prepdeck-0kh85z)

PrepDeck is a multi-exam practice platform for a small invited group, running on
Cloudflare Workers with static assets, D1, R2 and KV. It uses direct Google OAuth
and an application-managed allow-list. Infrastructure is designed for low cost;
actual usage and billing depend on the deployment's services and plan.

## Features

- Exam workspaces with practice, timed/resumable mock exams and sequential Learning.
- Personal statistics and activity heatmap, wrong-question review and bookmarks.
- Shared cached OpenAI/Anthropic explanations using your own API key; optional
  encrypted browser storage and Learning's Copy as prompt.
- Private annotations and configurable mark aliases, personal/shared question
  notes, and private Markdown Knowledge Points with images, Mermaid and links.
- Admin membership and question authoring, revision-safe edits, reviewed imports
  and history. Question editing uses a drawer with Save & add next.
- Configurable daily review email and signed unsubscribe.
- Separate User/Admin MCP endpoints, token management and audited Admin mutations.
- An offline PDF-to-import conversion Skill and separate [User](skills/prepdeck/SKILL.md)
  and [Admin](skills/prepdeck-admin/SKILL.md) MCP-backed Skills.

Start at the **[documentation index](docs/README.md)** for specifications,
architecture, setup and operations. The [delivery status and roadmap](docs/requirements/future-enhancements.md)
distinguishes implemented behavior and remaining gaps. See the
[Skill verification guide](docs/guides/skill-verification.md) for packaged checks.

## Repository

| Path | Responsibility |
| --- | --- |
| `apps/web` | React + Vite + TypeScript SPA, deployed as Worker static assets. |
| `apps/worker` | Hono API, Google OAuth, MCP servers, scheduled jobs and service bindings. |
| `packages/shared` | Shared types, validators, grading and import schema. |
| `migrations` | Ordered, executable D1 schema. |
| `skills/pdf-to-quiz` | Offline PDF conversion instructions/scripts and evidence workflow. |

## Development

Use Node.js 24 and npm. The default environment runs entirely on local Wrangler
simulations; no Cloudflare account, Google client or Docker is needed.

```bash
npm ci
npm run dev:setup
npm run dev
```

Open **http://localhost:8788** to sign in as the seeded local admin or user, then
select **Local practice examples**. State survives restarts. Use
`npm run dev:reset` for a clean local database, object store and caches.

The [development guide](docs/guides/development-and-deployment.md) covers local
accounts, resource inspection, simulated email, scheduled jobs, optional remote
integrations and deployment. See [contributing](.github/CONTRIBUTING.md) for
validation, [MCP setup](docs/guides/mcp-and-skills.md) for agent connections and
[security policy](SECURITY.md) for vulnerability reporting. Artwork and
third-party code attribution is recorded in [credits](CREDITS.md); everything is
released under the [MIT Licence](LICENSE).

## Public and private repositories

The [public/private repository guide](docs/guides/public-private-sync.md) describes
a history-free, sanitized export and reviewed one-way public-to-private updates.
Exporting creates local review files only; it never publishes a repository or
changes the visibility, remotes or history of the private deployment repository.
