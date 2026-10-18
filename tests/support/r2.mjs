// An R2 bucket for Node tests, held in a Map. It follows the parts of R2's
// contract that the Worker relies on:
// - get() resolves to null for a missing key, and otherwise to an object whose
//   body is a fresh stream on every read, with its httpMetadata;
// - list() pages through keys in lexicographic order, from a prefix, with a
//   cursor while `truncated` is true;
// - delete() takes one key or up to 1,000 at once.

// R2's limits (https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
export const R2_MAX_LIST_LIMIT = 1000;
export const R2_MAX_DELETE_KEYS = 1000;

/**
 * @typedef {{
 *   key: string,
 *   body: string | ArrayBuffer | ArrayBufferView | Blob,
 *   httpMetadata: R2HTTPMetadata,
 *   customMetadata: Record<string, string>,
 *   uploaded: Date,
 * }} R2Record
 * @typedef {"put" | "get" | "head" | "list" | "delete"} R2Method
 */

function size(body) {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof Blob) return body.size;
  return body.byteLength;
}

function metadata(record) {
  return {
    key: record.key,
    size: size(record.body),
    uploaded: record.uploaded,
    httpMetadata: record.httpMetadata,
    customMetadata: record.customMetadata,
    writeHttpMetadata(headers) {
      if (record.httpMetadata.contentType) headers.set("Content-Type", record.httpMetadata.contentType);
    },
  };
}

/**
 * @param {{ failures?: Partial<Record<R2Method, Error | null>> }} [options]
 *   `failures` names methods that throw the given error instead of running,
 *   as R2 does when it is unavailable. The same object is the bucket's
 *   `failures`, so a test can start or stop a failure part-way through.
 * @returns {R2Bucket & {
 *   objects: Map<string, R2Record>,
 *   deleteCalls: string[][],
 *   deleted: string[],
 *   failures: Partial<Record<R2Method, Error | null>>,
 *   seed: (key: string, body: R2Record["body"], options?: { httpMetadata?: R2HTTPMetadata, uploaded?: Date }) => void,
 * }}
 *   `objects` holds each stored object, its body kept as it was put (a stream
 *   is read into bytes). `deleteCalls` records the keys of each delete() that
 *   ran, and `deleted` every key deleted, in order. `seed` stores an object
 *   without recording anything, with an upload time of the test's choosing.
 */
export function createBucket({ failures = {} } = {}) {
  const objects = new Map();
  const deleteCalls = [];
  const deleted = [];

  function check(method) {
    const failure = failures[method];
    if (failure) throw failure;
  }

  function seed(key, body, { httpMetadata = {}, customMetadata = {}, uploaded = new Date() } = {}) {
    objects.set(key, { key, body, httpMetadata, customMetadata, uploaded });
  }

  return {
    objects,
    deleteCalls,
    deleted,
    failures,
    seed,
    async put(key, value, options = {}) {
      check("put");
      const body = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer()) : value ?? "";
      seed(key, body, { httpMetadata: options.httpMetadata, customMetadata: options.customMetadata });
      return metadata(objects.get(key));
    },
    async get(key) {
      check("get");
      const record = objects.get(key);
      if (!record) return null;
      const read = () => new Response(record.body);
      return {
        ...metadata(record),
        get body() { return read().body; },
        bodyUsed: false,
        text: () => read().text(),
        json: () => read().json(),
        arrayBuffer: () => read().arrayBuffer(),
        blob: () => read().blob(),
      };
    },
    async head(key) {
      check("head");
      const record = objects.get(key);
      return record ? metadata(record) : null;
    },
    async list({ prefix = "", cursor, limit = R2_MAX_LIST_LIMIT } = {}) {
      check("list");
      if (limit > R2_MAX_LIST_LIMIT) throw new Error(`R2 lists at most ${R2_MAX_LIST_LIMIT} keys at once; asked for ${limit}`);
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix) && (cursor === undefined || key > cursor)).sort();
      const page = keys.slice(0, limit);
      const truncated = keys.length > page.length;
      return {
        objects: page.map(key => metadata(objects.get(key))),
        truncated,
        ...(truncated ? { cursor: page.at(-1) } : {}),
        delimitedPrefixes: [],
      };
    },
    async delete(keys) {
      check("delete");
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.length > R2_MAX_DELETE_KEYS) throw new Error(`R2 deletes at most ${R2_MAX_DELETE_KEYS} keys at once; got ${list.length}`);
      deleteCalls.push([...list]);
      for (const key of list) {
        deleted.push(key);
        objects.delete(key);
      }
    },
  };
}
