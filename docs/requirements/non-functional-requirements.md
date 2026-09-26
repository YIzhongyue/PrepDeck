# Non-functional requirements

[Documentation index](../README.md)

## Performance and reliability

Target a small invited group and responsive desktop/mobile use. Bound request
bodies, pagination and SQL batches; use SQL filtering and indexes rather than
unbounded in-Worker computation. Measure CPU and database work under the actual
deployment plan rather than treating an old free-tier table as a performance SLA.
[Architecture](../architecture/system-overview.md#caches) defines cache scopes and
consistency limits; a cache hit does not mean every API call skips D1.

Mock deadlines use stored start/duration data; browser navigation cannot reset the
timer. Persist drafts/flags before leaving a session. Failed writes, empty data,
loading and stale/revision conflicts need distinct feedback. Never silently lose
editor content. Import batches and cross-service side effects can partially
complete; [authoring](../guides/question-bank-authoring.md) defines safe retry.

## Security and privacy

Google identity and invitation/role checks are server-side. The allow-list is D1
data, not an environment-variable secret. Browser auth can use a 600-second KV
cache, so it is not a globally immediate revocation guarantee. MCP validates the
current account and audience in D1 every request. Local password login requires
two explicit development switches and is disabled in production.

Enforce ownership for attempts, annotations, Knowledge Points and private images.
Only question notes support explicit sharing; a viewer's setting does not grant
access to private notes. Admin moderation is limited to shared notes. HTTPS is
required outside local development; production secrets belong in deployment secret
storage and local secrets in ignored environment files.

BYOK keys are transient request data, with opt-in AES-GCM browser storage under a
passphrase-derived key; the passphrase never goes to the backend and cannot be
recovered. Send question material, not requesting-user identity, to AI providers.
Restrict upstream URLs, body sizes and rate limits. Browser CSP and constrained
Markdown/Mermaid rendering reduce script execution risk; neither encrypted local
storage nor CSP makes an already-compromised browser safe. Source-coordinate
annotations must survive renderer changes explicitly.

Routine logs must exclude secrets, raw bodies and sensitive content. The current
logging inventory and deviations from that target are recorded honestly in the
[runbook](../operations/observability-runbook.md); do not equate the target with
complete implementation. MCP audit stores actor/target metadata and changed field
names, not full question payloads. No automatic audit-retention purge is claimed.

## Cost and capacity

Minimize infrastructure cost at the target scale, without promising $0 bills or
guaranteed quota headroom. The current footprint includes Worker assets, D1, R2,
KV, Durable Objects, native rate limiters, logs and Email Sending. Old Pages/Access
quota estimates and the dated free-tier appendix are superseded by account-specific
verification in [cost containment](../operations/cloudflare-cost-containment.md).
BYOK bills generation to the supplied provider key; cache hits reduce calls but
concurrent misses/regeneration can incur additional charges.

Distributed request limits and the HTTP circuit reduce amplification; they cannot
eliminate invocation costs or automatically stop scheduled jobs. WAF/responder
configuration must be verified separately from repository code.

## Maintainability and accessibility

New exams use shared bank contracts. New question types require explicit schema,
validator, renderer and grader support with backward-compatible existing data;
they are not enabled merely by accepting a new string. Keep the import schema
versioned and migration chain authoritative.

Target evergreen browsers, keyboard navigation and a 375px mobile viewport.
Marks must remain legible across themes and not depend on color alone; labels and
accessible names carry meaning. Learning and unanswered testing need visibly
different presentation. Text meets WCAG 2.1 AA contrast (4.5:1) in every
scheme. Answer options are radios in single choice and checkboxes in multiple
choice, and graded options say in words which answer was chosen and which is
correct. An automated axe-core scan of the main screens in all five schemes
runs in CI and fails on serious or critical violations (see
[Development and deployment](../guides/development-and-deployment.md#accessibility-scan)).
Remaining Knowledge Point WYSIWYG/IME/touch/accessibility
verification is [tracked work](future-enhancements.md), not blanket compliance.
