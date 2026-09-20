interface Counter { count: number; resetAt: number }

/** A Durable Object serializes requests for one key, making increments global
 * across Worker isolates and atomic even under concurrent requests. */
export class RateLimiterObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { windowSeconds, max } = await request.json<{ windowSeconds: number; max: number }>();
    if (!Number.isFinite(windowSeconds) || !Number.isFinite(max) || windowSeconds <= 0 || max <= 0) {
      return new Response("Invalid limit", { status: 400 });
    }
    const now = Date.now();
    const result = await this.state.storage.transaction(async (txn) => {
      let counter = await txn.get<Counter>("counter");
      if (!counter || counter.resetAt <= now) counter = { count: 0, resetAt: now + windowSeconds * 1000 };
      counter.count += 1;
      await txn.put("counter", counter);
      return { allowed: counter.count <= max, retryAfter: Math.max(1, Math.ceil((counter.resetAt - now) / 1000)) };
    });
    return Response.json(result);
  }
}
