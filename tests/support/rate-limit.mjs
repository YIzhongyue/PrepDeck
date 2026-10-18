// The Worker's two rate-limit bindings, for Node tests.
//
// RATE_LIMITER is a Durable Object namespace (src/rateLimiterObject.ts): the
// Worker names an object per key and POSTs { windowSeconds, max } to it, and
// the object answers { allowed, retryAfter }. The fake's ids are the names
// themselves, so a test can tell keys apart from the id get() receives.
//
// IMPORT_*_RATE_LIMITER are Cloudflare's native rate-limit bindings:
// limit({ key }) resolves to { success }.

/**
 * @typedef {{ key: string, windowSeconds: number, max: number }} RateLimiterCall
 * @typedef {{ allowed: boolean, retryAfter: number }} RateLimiterResult
 * @typedef {(call: RateLimiterCall & { count: number }) => RateLimiterResult | undefined | Promise<RateLimiterResult | undefined>} RateLimiterRespond
 */

/**
 * The RATE_LIMITER Durable Object namespace.
 *
 * @param {{ counting?: boolean, retryAfter?: number, respond?: RateLimiterRespond }} [options]
 *   By default every request is allowed. With `counting`, a key allows `max`
 *   requests and refuses the rest, as the object does within one window (the
 *   window never resets: no test runs that long). `respond` decides a request
 *   first: it may return a result, throw to make the stub's fetch fail as an
 *   unreachable object does, or return undefined to leave the request to the
 *   default. It is also the limiter's `respond` property, so a test can
 *   change it part-way through.
 * @returns {DurableObjectNamespace & { calls: RateLimiterCall[], counts: Map<string, number>, respond?: RateLimiterRespond }}
 *   `calls` records every request, `counts` the requests per key.
 */
export function createRateLimiter({ counting = false, retryAfter = 60, respond } = {}) {
  const calls = [];
  const counts = new Map();
  const limiter = {
    calls,
    counts,
    respond,
    idFromName: name => name,
    get: key => ({
      async fetch(input, init) {
        const request = input instanceof Request ? input : new Request(input, init);
        const { windowSeconds, max } = await request.json();
        const call = { key, windowSeconds, max };
        calls.push(call);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        const result = (await limiter.respond?.({ ...call, count })) ?? { allowed: !counting || count <= max, retryAfter };
        return Response.json(result);
      },
    }),
  };
  return limiter;
}

/**
 * A native rate-limit binding.
 *
 * @param {{ success?: boolean, respond?: (call: { key: string }) => { success: boolean } | undefined }} [options]
 *   `success` is every request's answer. `respond`, like createRateLimiter's,
 *   decides a request first and may throw, as the binding does when
 *   Cloudflare's limiter is unreachable; it is also the binding's `respond`
 *   property.
 * @returns {RateLimit & { calls: { key: string }[], respond?: (call: { key: string }) => { success: boolean } | undefined }}
 */
export function createRateLimit({ success = true, respond } = {}) {
  const calls = [];
  const binding = {
    calls,
    respond,
    async limit({ key }) {
      calls.push({ key });
      return (await binding.respond?.({ key })) ?? { success };
    },
  };
  return binding;
}
