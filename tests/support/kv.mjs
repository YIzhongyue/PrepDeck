// A Workers KV namespace for Node tests, held in a Map. It follows the parts
// of KV's contract that the Worker relies on:
// - get() resolves to null for a missing key, to the stored string by
//   default, and to the parsed value with the "json" type;
// - put() refuses an expirationTtl under 60 seconds and a value over 25 MiB,
//   as KV does. Expiry itself is not modelled: no test runs long enough.

// KV's limits (https://developers.cloudflare.com/kv/platform/limits/).
export const KV_MIN_EXPIRATION_TTL = 60;
export const KV_MAX_VALUE_BYTES = 25 * 1024 * 1024;

/**
 * @typedef {{ method: "put", key: string, value: string, options?: KVNamespacePutOptions }
 *   | { method: "delete", key: string }} KvWrite
 */

/**
 * @param {{ failures?: Partial<Record<"get" | "put" | "delete", Error | null>> }} [options]
 *   `failures` names methods that throw the given error instead of running,
 *   as KV does when it is unavailable. The same object is the namespace's
 *   `failures`, so a test can start or stop a failure part-way through.
 * @returns {KVNamespace & {
 *   store: Map<string, string>,
 *   writes: KvWrite[],
 *   deletes: string[],
 *   failures: Partial<Record<"get" | "put" | "delete", Error | null>>,
 * }}
 *   `store` holds each key's stored string; a test may read or seed it
 *   directly. `writes` records every put and delete that ran, in order, and
 *   `deletes` the keys deleted, in order (cache invalidations, mostly).
 */
export function createKv({ failures = {} } = {}) {
  const store = new Map();
  const writes = [];
  const deletes = [];

  function check(method) {
    const failure = failures[method];
    if (failure) throw failure;
  }

  return {
    store,
    writes,
    deletes,
    failures,
    async get(key, options) {
      check("get");
      const type = typeof options === "string" ? options : options?.type ?? "text";
      if (!store.has(key)) return null;
      const value = store.get(key);
      if (type === "json") return JSON.parse(value);
      if (type === "text") return value;
      throw new Error(`The KV fake reads "text" and "json" values, not ${type}`);
    },
    async put(key, value, options) {
      check("put");
      const ttl = options?.expirationTtl;
      if (ttl !== undefined && !(ttl >= KV_MIN_EXPIRATION_TTL)) {
        throw new Error(`KV expirationTtl must be at least ${KV_MIN_EXPIRATION_TTL} seconds; got ${ttl}`);
      }
      const text = String(value);
      if (Buffer.byteLength(text) > KV_MAX_VALUE_BYTES) throw new Error(`KV values are at most ${KV_MAX_VALUE_BYTES} bytes: ${key}`);
      writes.push({ method: "put", key, value: text, ...(options === undefined ? {} : { options }) });
      store.set(key, text);
    },
    async delete(key) {
      check("delete");
      writes.push({ method: "delete", key });
      deletes.push(key);
      store.delete(key);
    },
  };
}
