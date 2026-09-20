// Thin fetch wrapper for the Worker API. In dev, Vite proxies /api/* to
// `wrangler dev` (see vite.config.ts); in production the SPA and the API are
// served from the same Worker (see apps/worker/wrangler.toml [assets]), so a
// relative path works in both cases.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include"
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, (body && body.error) || `Request to ${path} failed with ${res.status}`, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
