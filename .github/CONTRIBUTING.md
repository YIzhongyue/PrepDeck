![PrepDeck](/imgs/PrepDeck-horizontal-logo-with-kanbanmusume-blue.png)

# Contributing to PrepDeck

Thank you for taking the time to improve PrepDeck. Contributions of all sizes
are welcome, including bug reports, documentation updates, tests, and new
features.

## Before you start

- Search the existing issues and pull requests to avoid duplicating work.
- For a large feature, schema change, or architectural change, open an issue
  first so the approach and scope can be discussed.
- Never commit credentials, API keys, Cloudflare resource identifiers, or
  personal data. Use local environment files for secrets.

## Project layout

PrepDeck is an npm workspace-based TypeScript project:

- `apps/web` contains the React and Vite single-page application. Its shared
  form primitives under `src/components/base` are vendored Untitled UI React
  source; see the [shared UI components guide](../docs/guides/ui-components.md)
  before editing or adding to them.
- `apps/worker` contains the Hono API deployed to Cloudflare Workers.
- `packages/shared` contains types and schemas shared by the web app and API.
- `migrations` contains ordered Cloudflare D1 migrations.
- `skills/pdf-to-quiz` contains the companion PDF-to-quiz skill.

For more information about the features and architecture, see the root
[`README.md`](../README.md) and the
[documentation index](../docs/README.md).

## Set up a development environment

### Prerequisites

- Node.js 24 (the CI runtime; the test suite uses native TypeScript and SQLite)
- npm

Install dependencies from the repository root:

```bash
npm ci
```

Run `npm run dev:setup`, then `npm run dev`. Open
http://localhost:8788 to sign in with the seeded local account. The
[development guide](../docs/guides/development-and-deployment.md) explains the
complete cloud-independent workflow, local email, state reset and scheduled jobs.
All local bindings are explicit and the launcher disables remote bindings.

## Make a change

1. Create a focused branch from the appropriate base branch.
2. Keep each commit limited to one logical change and write a clear,
   imperative commit message.
3. Follow the existing code style and the repository's `.editorconfig`.
4. Update shared types or schemas when an API contract changes.
5. Add a new numbered migration for database changes. Never modify a migration
   that may already have been applied.
6. Add or update tests and documentation when behavior changes. Use the
   [documentation ownership rules](../docs/README.md#maintaining-this-reference),
   preserve FR IDs and distinguish implemented behavior from planned work.

## Validate your work

Run the checks relevant to your change from the repository root:

```bash
# Type-check all workspaces
npm run typecheck

# Run Worker tests
npm test --workspace apps/worker

# Build the web application
npm run build --workspace apps/web
```

Avoid using the root `npm run build` as a general local validation command.
The Worker build hook applies remote D1 migrations in Cloudflare Workers Builds
when `WORKERS_CI=1` and the build branch is the production branch; migrations
and deployments should only run in an explicitly authorized environment.

Also test user-facing changes manually in the local application. Check both
the success and error paths, and verify that the interface remains usable at
different viewport sizes when changing the web app.

## Submit a pull request

Open the pull request against the repository's default branch unless a
maintainer requests another base branch. Keep the pull request focused and
include:

- a concise explanation of the problem and solution;
- links to related issues;
- notes about migrations, configuration changes, or compatibility concerns;
- the commands used to validate the change; and
- screenshots or recordings for visible UI changes.

Before requesting review, confirm that:

- [ ] The type checks, Worker tests, and relevant builds pass.
- [ ] New behavior is covered by tests where practical.
- [ ] Documentation and examples reflect the change.
- [ ] No secrets, generated artifacts, or unrelated changes are included.
- [ ] The pull request is small enough to review effectively.

Review feedback is part of the contribution process. Please respond to comments
and keep the branch up to date until the pull request is ready to merge.

## Report security issues

Do not disclose suspected vulnerabilities in a public issue. Instead, use the
repository owner's private contact method or GitHub's private vulnerability
reporting feature, if available, and include enough detail to reproduce and
assess the issue safely.

## License

By contributing, you agree that your contributions will be licensed under the
terms of the repository's [MIT License](../LICENSE).

![PrepDeck](/imgs/PrepDeck_Thanks.png)
