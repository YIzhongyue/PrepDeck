// The Worker's KV, R2 and rate-limit bindings, all faked, for a test that
// runs the whole Worker or a route that touches several of them. D1 is left
// to the test, since each one builds its own database.
import { createKv } from "./kv.mjs";
import { createBucket } from "./r2.mjs";
import { createRateLimit, createRateLimiter } from "./rate-limit.mjs";

export function createBindings() {
  return {
    KV: createKv(),
    BUCKET: createBucket(),
    RATE_LIMITER: createRateLimiter(),
    IMPORT_VALIDATE_RATE_LIMITER: createRateLimit(),
    IMPORT_EXECUTE_RATE_LIMITER: createRateLimit(),
  };
}
