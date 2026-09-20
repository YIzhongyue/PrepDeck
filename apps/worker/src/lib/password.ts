// Dev-mode-only password hashing (see routes/auth.ts). PBKDF2 via the
// platform Web Crypto API — no external dependency, and the same primitive
// Node's `crypto.webcrypto` exposes, so the seed script can produce hashes
// this verifies without going through the deployed Worker.

const ITERATIONS = 100_000;
const HASH = "SHA-256";
const KEY_LENGTH_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: HASH },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

// Stored form: "pbkdf2$<iterations>$<saltB64>$<hashB64>".
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const [, iterationsStr, saltB64, hashB64] = parts as [string, string, string, string];
  const iterations = parseInt(iterationsStr, 10);
  if (iterations !== ITERATIONS) return false; // no legacy formats to support yet

  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = await derive(password, salt);
  if (actual.length !== expected.length) return false;

  // Constant-time compare — this guards a password hash, not just any string.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
