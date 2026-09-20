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

export function setSessionKey(key: string): void {
  sessionKey = key;
}
export function getSessionKey(): string | null {
  return sessionKey;
}
export function hasSessionKey(): boolean {
  return sessionKey != null;
}
export function clearSessionKey(): void {
  sessionKey = null;
}

const DB_NAME = "prepdeck-keystore";
const STORE_NAME = "keys";
const RECORD_ID = "ai-provider-key";
const PBKDF2_ITERATIONS = 250_000;

interface StoredRecord {
  salt: number[];
  iv: number[];
  ciphertext: number[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<StoredRecord | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RECORD_ID);
    req.onsuccess = () => resolve(req.result as StoredRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: StoredRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, RECORD_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(): Promise<void> {
  const db = await openDb();
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

export async function hasStoredEncryptedKey(): Promise<boolean> {
  try {
    return (await idbGet()) !== undefined;
  } catch {
    return false;
  }
}

export async function saveEncryptedKey(apiKey: string, passphrase: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(apiKey));
  await idbPut({ salt: Array.from(salt), iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) });
}

export class UnlockError extends Error {}

export async function loadEncryptedKey(passphrase: string): Promise<string> {
  const record = await idbGet();
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

export async function clearStoredEncryptedKey(): Promise<void> {
  await idbDelete();
}
