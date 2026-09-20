# Security Policy

## Supported Versions

PrepDeck is under active development and does not currently maintain multiple
versioned release lines. Security fixes are applied to the latest code on the
default branch.

| Version | Supported |
| --- | --- |
| Latest code on the default branch | Yes |
| Older commits, forks, and unofficial deployments | No |

Deployers are responsible for keeping their PrepDeck installation, Cloudflare
configuration, and dependencies up to date.

## Reporting a Vulnerability

Please do not report suspected security vulnerabilities through public GitHub
issues, pull requests, discussions, or other public channels.

Use GitHub's private vulnerability reporting feature to submit a report:

[Report a vulnerability privately](https://github.com/YIzhongyue/PrepDeck/security/advisories/new)

If private vulnerability reporting is unavailable, contact the repository owner
through GitHub and request a private communication channel. Do not include
sensitive vulnerability details in the initial public message.

A useful report should include:

- A clear description of the vulnerability and its potential impact.
- The affected component, route, feature, or configuration.
- The commit, deployment version, or environment where the issue was observed.
- Detailed reproduction steps or a minimal proof of concept.
- Relevant logs, screenshots, request and response samples, or stack traces.
- Any conditions required to exploit the issue.
- Suggested mitigations or fixes, if available.
- Whether the issue has been disclosed to anyone else.

Remove credentials, API keys, session tokens, personal data, and other unrelated
sensitive information from all submitted material.

## Security-Sensitive Areas

Reports involving the following areas are especially important:

- Authentication, authorization, role-based access control, or session handling.
- Cloudflare Access integration and identity validation.
- Unauthorized access to questions, attempts, notes, annotations, statistics,
  or administrative functionality.
- Exposure or persistence of user-provided OpenAI or Anthropic API keys.
- Circumvention of client-side encryption or protection for locally stored API
  key material.
- Injection vulnerabilities, including SQL injection and cross-site scripting.
- Cross-user or cross-group data access.
- Unsafe question imports, file processing, or generated content.
- Disclosure of Cloudflare D1, R2, KV, Worker, or deployment credentials.
- Abuse of the AI explanation proxy, including unauthorized requests or
  unintended secret forwarding.
- Vulnerabilities in dependencies that are demonstrably exploitable in
  PrepDeck.

## What to Expect

After receiving a report, the maintainers will make a reasonable effort to:

1. Acknowledge the report and confirm that it can be reviewed.
2. Investigate the reported behavior and determine its impact.
3. Request additional information when necessary.
4. Develop and validate an appropriate fix or mitigation.
5. Coordinate disclosure after affected users have had a reasonable opportunity
   to apply the fix.

Response and remediation times depend on the severity, complexity, and
maintainer availability. Please allow reasonable time for investigation before
disclosing the issue publicly.

The maintainers may close reports that cannot be reproduced, do not present a
meaningful security impact, or concern unsupported deployments. When practical,
an explanation will be provided.

## Responsible Disclosure

Researchers are asked to:

- Make a good-faith effort to avoid privacy violations, data loss, service
  disruption, and degradation of the project or its infrastructure.
- Test only against systems and accounts they own or are explicitly authorized
  to use.
- Access only the minimum amount of data necessary to demonstrate the issue.
- Stop testing and report the issue immediately if personal data, credentials,
  or other sensitive information is encountered.
- Avoid denial-of-service testing, automated high-volume scanning, spam, social
  engineering, phishing, and physical security testing.
- Keep vulnerability details confidential until disclosure has been coordinated
  with the maintainers.
- Comply with applicable laws and the terms of any third-party services involved,
  including Cloudflare and configured AI providers.

This policy does not authorize testing against deployments operated by other
people or organizations. Obtain explicit permission from the relevant operator
before testing an installation that you do not own.

## Out of Scope

The following are generally outside the scope of this policy unless they create
a direct, demonstrable security impact in PrepDeck:

- Vulnerabilities that affect only outdated browsers, unsupported runtimes, or
  unmodified third-party software.
- Findings based solely on automated scanner output without a reproducible
  impact.
- Missing security headers or defense-in-depth recommendations without an
  exploitable condition.
- Rate-limit observations that do not enable meaningful abuse.
- Self-XSS or issues requiring a victim to paste or execute attacker-controlled
  code.
- Social engineering, phishing, physical attacks, or denial-of-service testing.
- Vulnerabilities in a third-party service that should be reported directly to
  that service's provider.
- Issues caused exclusively by an operator's insecure deployment,
  misconfigured Cloudflare resources, or exposed local environment files.
- Feature requests, general bugs, and documentation errors without security
  implications.

Non-security bugs should be reported through the repository's regular GitHub
issue process.

## Secrets and Credentials

Never include real API keys, Cloudflare credentials, session secrets, access
tokens, production database contents, or personal information in an issue,
pull request, test fixture, screenshot, or proof of concept.

If a credential may have been exposed, revoke or rotate it immediately. Removing
a secret from the latest commit is not sufficient because it may remain in the
Git history, caches, logs, build artifacts, or forks.

Local development credentials are generated/seeded only into Wrangler's local
state and must never be used for a deployment. The default launcher disables
remote bindings and the deployment configuration disables password login.
Keep `.dev.vars*`, `.local-state/` and integration-specific configuration private.
Before creating a public repository, follow the
[sanitized snapshot review](docs/guides/public-private-sync.md); deleting a secret
or restricted seed in a later commit does not remove it from earlier history.

## Deployment Security

PrepDeck operators should follow these basic security practices:

- Use a strong, unique `SESSION_SECRET` and store it through an appropriate
  secret-management mechanism.
- Restrict Cloudflare D1, R2, KV, and Worker permissions to the minimum required.
- Configure Cloudflare Access and administrative roles carefully.
- Keep Node.js, npm dependencies, Wrangler, and deployed application code up to
  date.
- Review database migrations before applying them to production.
- Never commit `.dev.vars`, API keys, tokens, or production configuration
  containing secrets.
- Monitor authentication, administrative actions, AI proxy usage, and provider
  quotas for unexpected activity.
- Back up important data and test recovery procedures before deploying major
  changes.

## Safe Harbor

The project maintainers intend to treat good-faith security research conducted
in accordance with this policy as authorized. Researchers who follow this
policy, avoid harm, and report findings responsibly will not be pursued by the
project maintainers solely for their research.

This safe-harbor statement does not bind third parties and does not authorize
violations of applicable law, third-party terms of service, or the rights of
other users or deployment operators.
