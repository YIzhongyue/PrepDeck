// Only for derived data and deletion of obsolete keys no reader trusts.
// Never wrap identity/session lookups, authorization or rate-limit decisions.
type Producer = "practice" | "stats" | "legacy_identity_cleanup";
type Operation = "get" | "put" | "delete";
const notices = new WeakMap<object, Map<string, number>>();
const flights = new WeakMap<object, Map<string, Promise<unknown>>>();

export async function optionalCache<T>(namespace: object, producer: Producer, operation: Operation, fallback: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    let seen = notices.get(namespace);
    if (!seen) notices.set(namespace, seen = new Map());
    const key = `${producer}:${operation}`;
    const now = Date.now();
    if (!seen.has(key) || now - seen.get(key)! >= 30_000) {
      seen.set(key, now);
      // Fixed vocabulary only: no keys, account identifiers, payloads or errors.
      console.warn(JSON.stringify({ event: "optional_cache_failure", producer, operation, mode: "authoritative_fallback" }));
    }
    return fallback;
  }
}

// An optimization within one isolate, not a distributed budget or lock. Keep
// no completed entries, and bound bookkeeping during bursts of distinct keys.
export async function cacheSingleFlight<T>(namespace: object, key: string, work: () => Promise<T>): Promise<T> {
  let pending = flights.get(namespace);
  if (!pending) flights.set(namespace, pending = new Map());
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  if (pending.size >= 256) return work();
  const promise = work();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}
