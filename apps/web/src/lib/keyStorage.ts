// docs/requirements/ai-explanations.md — BYOK API key handling. By default (FR-7.0) a key lives
// only in this module-level variable: real browser runtime memory, outside
// React state, so it never round-trips through component re-renders, dev
// tools state inspectors, or the app's own persisted store. It is cleared on
// refresh/close, same as any other in-memory value.
//
// FR-7.9 (opt-in): a user may instead have the key encrypted with AES-GCM
// (key derived from a passphrase via PBKDF2) and the ciphertext kept in
// IndexedDB, surviving a refresh. The passphrase itself is never sent
// anywhere; losing it means losing the saved key with no recovery path.

let sessionKey: string | null = null;
let identity: string | null = null;
let revision = 0;
const REVOCATION_KEY = "prepdeck:key-revocation";
const listeners = new Set<() => void>();
const readRevocation = () => {
  try { return localStorage.getItem(REVOCATION_KEY); } catch { return null; }
};
let revocation = readRevocation();

function clearLocalKey(): void {
  sessionKey = null;
  revision++;
  for (const listener of listeners) listener();
}

// Read synchronously too: storage events can be delayed while a tab sleeps.
function syncRevocation(): void {
  const current = readRevocation();
  if (current !== revocation) { revocation = current; clearLocalKey(); }
}

export function bindKeyIdentity(userId: string | null): void {
  syncRevocation();
  if (identity === userId) return;
  identity = userId;
  clearLocalKey();
}

export function keyRevision(): number { syncRevocation(); return revision; }

export function subscribeSessionKey(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === REVOCATION_KEY || event.key === null) syncRevocation(); };
  const onRestore = (event: PageTransitionEvent) => { if (event.persisted) clearLocalKey(); else syncRevocation(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onRestore);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onRestore);
  };
}

export function setSessionKey(userId: string, key: string, expectedRevision = keyRevision()): boolean {
  syncRevocation();
  if (userId !== identity || expectedRevision !== revision) return false;
  sessionKey = key;
  revision++;
  for (const listener of listeners) listener();
  return true;
}
export function getSessionKey(userId: string | null): string | null {
  syncRevocation();
  return userId && userId === identity ? sessionKey : null;
}
export function hasSessionKey(userId: string | null): boolean {
  return getSessionKey(userId) != null;
}
export function clearSessionKey(): void {
  clearLocalKey();
  // Only a random invalidation marker is shared; never the key or ciphertext.
  revocation = crypto.randomUUID();
  try { localStorage.setItem(REVOCATION_KEY, revocation); } catch { /* Per-request identity checks still apply. */ }
}

// One database per account (issue #46). A single browser-wide database let the
// next account signed in on a shared browser see that a key was stored, be
// offered to unlock it, and overwrite or delete it.
const DB_NAME_PREFIX = "prepdeck-keystore";
const dbName = (userId: string) => `${DB_NAME_PREFIX}:${userId}`;
// The browser-wide database from before: its owner is unknown, so it is never
// read, and it is removed when anyone signs out of this browser.
const LEGACY_DB_NAME = DB_NAME_PREFIX;
const STORE_NAME = "keys";
const RECORD_ID = "ai-provider-key";
const PBKDF2_ITERATIONS = 250_000;

interface StoredRecord {
  salt: number[];
  iv: number[];
  ciphertext: number[];
}

function openDb(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(userId), 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(userId: string): Promise<StoredRecord | undefined> {
  const db = await openDb(userId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RECORD_ID);
    req.onsuccess = () => resolve(req.result as StoredRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(userId: string, value: StoredRecord): Promise<void> {
  const db = await openDb(userId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, RECORD_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(userId: string): Promise<void> {
  const db = await openDb(userId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(RECORD_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function hasStoredEncryptedKey(userId: string): Promise<boolean> {
  try {
    return (await idbGet(userId)) !== undefined;
  } catch {
    return false;
  }
}

export async function saveEncryptedKey(userId: string, apiKey: string, passphrase: string, expectedRevision = keyRevision()): Promise<boolean> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(apiKey));
  if (userId !== identity || expectedRevision !== keyRevision()) return false;
  await idbPut(userId, { salt: Array.from(salt), iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) });
  return true;
}

export class UnlockError extends Error {}

export async function loadEncryptedKey(userId: string, passphrase: string): Promise<string> {
  const record = await idbGet(userId);
  if (!record) throw new UnlockError("No saved key found");
  const key = await deriveKey(passphrase, new Uint8Array(record.salt));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      key,
      new Uint8Array(record.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new UnlockError("Wrong passphrase");
  }
}

export async function clearStoredEncryptedKey(userId: string): Promise<void> {
  await idbDelete(userId);
}

export function deleteLegacyKeystore(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
