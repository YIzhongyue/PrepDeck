# AI explanations

[Documentation index](../README.md)

OpenAI and Anthropic are supported through a same-origin BYOK relay. Provider keys
default to browser memory, with optional passphrase-encrypted IndexedDB storage.
The [AI route](../../apps/worker/src/routes/ai.ts),
[prompt template](../../apps/worker/prompts/explanation.njk) and
[key storage](../../apps/web/src/lib/keyStorage.ts) are the implementation sources.

The model list is maintained in [shared AI definitions](../../packages/shared/src/ai.ts).
A custom model ID is input flexibility, not a compatibility guarantee for every
provider model. Generation currently uses a fixed 2,048 output-token budget.
The body guard is configured as 32 KiB but checks declared content length and
decoded JavaScript string length; it is not a streaming UTF-8 byte counter.
See [rate limits](../operations/cloudflare-rate-limits.md).

The shared cache is deliberate for this trusted group, but it is not an
exactly-once billing guarantee: simultaneous misses, force regeneration, failed
requests or invalidation may result in additional provider calls. Provider charges
belong to the supplied key's account. Question changes invalidate affected caches;
see [answer revisions and caches](../guides/question-bank-authoring.md#answer-revisions-and-caches).

Concurrent first-generation responses preserve the first stored explanation,
including any later manual correction. The response uses the stored owner's
permissions. Force regeneration checks both authorization and the content read
before its upstream request; if that content changes, it returns a conflict
instead of overwriting the intervening edit.

Priorities: M = Must, S = Should, C = Could; priority is not delivery status.

## AI explanations

<a id="fr-7-0"></a>

- **FR-7.0 (M):** A per-user **Settings** page lets the user (a) choose an active AI provider — OpenAI or Anthropic; (b) enter that provider's API key; (c) choose a model from a curated, provider-specific dropdown (with an option to enter a custom model identifier for advanced use). **By default, the key is held only in browser runtime memory** (e.g., an in-memory JS variable/store) and is automatically cleared when the page is refreshed or closed — it is **not** written to `localStorage`/`sessionStorage`/IndexedDB unless the user explicitly opts in per FR-7.9.

<a id="fr-7-1"></a>

- **FR-7.1 (M):** For any question, a user can request an AI-generated explanation of the correct answer (available in practice review, mock-exam review, wrong-question book, bookmarks views, and Learning Mode per FR-14.5).

<a id="fr-7-2"></a>

- **FR-7.2 (M):** Before calling any AI provider, the client asks the Worker whether a cached explanation already exists for that question (see FR-7.3 for cache keying). If found, it is displayed immediately — at no cost and with **no API key required**, even for a user who has not configured one.

<a id="fr-7-3"></a>

- **FR-7.3 (M):** The **shared explanation cache** (`ai_explanations` table in D1) is keyed by **(`question_id`, `provider`, `model`)**, not by `question_id` alone, since OpenAI and Anthropic — and different models within each — may phrase explanations differently. A cache hit for the user's *currently selected* provider/model is shown by default; if only a different provider/model's cached explanation exists, the UI may offer to show it, clearly labeled (e.g., "Explanation generated with GPT-4o"), before offering to generate a new one with the user's own settings.

<a id="fr-7-4"></a>

- **FR-7.4 (M):** On a cache miss, the browser sends question ID, provider, model and the loaded API key to `POST /api/ai/generate`. The Worker constructs the prompt from the current stored question and relays it only to fixed provider endpoints. It does not accept an arbitrary upstream URL or a browser-authored prompt. The key is transient request data, never persisted to D1/KV/R2 or deliberately logged.

<a id="fr-7-5"></a>

- **FR-7.5 (M):** After successful generation, cache the explanation content and provenance metadata, never the API key, by `(question_id, provider, model)`. The insert is conditional on the question revision used for generation; a concurrent question edit cannot restore a stale cached explanation. Later cache hits require no provider call or API key.

<a id="fr-7-6"></a>

- **FR-7.6 (M):** If no key is currently loaded (never entered, cleared on refresh, or not yet unlocked from encrypted storage per FR-7.9) and no cached explanation exists for that question under any provider/model, the UI must prompt the user to enter/unlock a key in Settings rather than silently failing.

<a id="fr-7-7"></a>

- **FR-7.7 (S):** Admin (or the original requester) can force-regenerate a specific cached `(question_id, provider, model)` entry, or manually edit its stored text.

<a id="fr-7-8"></a>

- **FR-7.8 (M):** If the official explanation extracted from the source PDF (via the Skill) is present on the question, it is shown alongside (not replacing) any AI-generated explanation(s).

<a id="fr-7-9"></a>

- **FR-7.9 (S):** As an **opt-in** alternative to the in-memory default (FR-7.0), a user may choose to persist their API key across sessions by setting a personal passphrase. The app derives an encryption key from that passphrase (e.g., via PBKDF2 or an equivalent KDF), encrypts the API key with **AES-GCM**, and stores only the ciphertext in the browser's IndexedDB. On a later visit, the user must re-enter the passphrase to decrypt the key back into memory before it can be used (per FR-7.4); the passphrase itself is never sent to or stored by the backend, and losing it means losing the saved key with no recovery path — the UI must state this plainly before the user opts in.
