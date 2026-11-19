import type { ExamBadgeImportError, ExamBadgeImportResult, ExamBadgeSource } from "@prepdeck/shared";
import type { Env } from "../bindings";
import { hasValidImageContent, ICON_CONTENT_TYPES, type IconContentType } from "./imageValidation";

export const MAX_EXAM_BADGE_BYTES = 2 * 1024 * 1024;
export const isBadgeContentType = (value: string): value is IconContentType => ICON_CONTENT_TYPES.some((type) => type === value);

const BUILTIN_SOURCES = new Map<string, ExamBadgeSource>([["nca-aiio", {
  imageUrl: "https://images.credly.com/images/3d924691-436a-4fb6-b19b-1005ccbb6135/blob",
  issuerUrl: "https://www.credly.com/org/nvidia/badge/nvidia-certified-associate-ai-infrastructure-and-op.1/",
}]]);
const FETCH_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const DNS_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i;
const BADGE_VERSION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

interface BadgeTarget {
  slug: string;
  badge_icon_url: string | null;
  badge_source_image_url: string | null;
  badge_source_issuer_url: string | null;
}

const targetColumns = "slug, badge_icon_url, badge_source_image_url, badge_source_issuer_url";

export function getBadgeTarget(db: D1Database, examId: string) {
  return db.prepare(`SELECT ${targetColumns} FROM exams WHERE id = ?`).bind(examId).first<BadgeTarget>();
}

export function resolveBadgeSource(target: BadgeTarget): ExamBadgeSource | null {
  const { badge_source_image_url: imageUrl, badge_source_issuer_url: issuerUrl } = target;
  if (imageUrl && issuerUrl) return { imageUrl, issuerUrl };
  return BUILTIN_SOURCES.get(target.slug.toLowerCase()) ?? null;
}

function approvedImageUrl(value: string, extraHosts: string | undefined): URL | null {
  const url = value.length <= 2048 ? URL.parse(value) : null;
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port || !DNS_HOST.test(url.hostname)) return null;
  const approved = url.hostname === "images.credly.com" ||
    extraHosts?.split(",").some((host) => host.trim().toLowerCase() === url.hostname);
  return approved ? url : null;
}

export function isApprovedBadgeSource(source: ExamBadgeSource, env: Pick<Env, "EXAM_BADGE_IMAGE_HOSTS">): boolean {
  return approvedImageUrl(source.imageUrl, env.EXAM_BADGE_IMAGE_HOSTS) !== null;
}

type Download = { body: ArrayBuffer; type: IconContentType } | { reason: ExamBadgeImportError };

async function readBadgeImage(response: Response): Promise<Download> {
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (Number(response.headers.get("content-length")) > MAX_EXAM_BADGE_BYTES) {
    void response.body?.cancel().catch(() => {});
    return { reason: "image_too_large" };
  }
  if (!isBadgeContentType(type) || !response.body) {
    void response.body?.cancel().catch(() => {});
    return { reason: "invalid_image" };
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(MAX_EXAM_BADGE_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > bytes.byteLength) {
        void reader.cancel().catch(() => {});
        return { reason: "image_too_large" };
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const body = bytes.buffer.slice(0, size);
  return hasValidImageContent(body, type) ? { body, type } : { reason: "invalid_image" };
}

async function downloadBadge(imageUrl: string, extraHosts: string | undefined): Promise<Download> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let next = imageUrl;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const url = approvedImageUrl(next, extraHosts);
      if (!url) return { reason: "source_not_allowed" };
      // Some issuer CDNs refuse requests that have no User-Agent.
      const response = await fetch(url, {
        redirect: "manual", signal,
        headers: { Accept: ICON_CONTENT_TYPES.join(", "), "User-Agent": "PrepDeck exam badge importer" },
      });
      if (response.ok) return await readBadgeImage(response);
      void response.body?.cancel().catch(() => {});
      const location = response.headers.get("location");
      if (!REDIRECT_STATUS_CODES.has(response.status) || !location) break;
      next = new URL(location, url).href;
    }
  } catch {
    // A timeout, network failure or incomplete response can be retried.
  }
  return { reason: "download_failed" };
}

export function examBadgeObjectKey(examId: string, version?: string): string {
  const base = `exam-badges/${examId}`;
  return version && BADGE_VERSION.test(version) ? `${base}/${version}` : base;
}

async function discardBadge(bucket: R2Bucket, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch {
    console.warn("exam_badge_cleanup_failed");
  }
}

/** Upload an immutable candidate before publishing its URL. The compare-and-set
 * keeps a concurrent upload or source edit from being overwritten by a late import. */
export async function storeExamBadge(
  env: Pick<Env, "DB" | "BUCKET">, examId: string, previousUrl: string | null,
  body: ArrayBuffer, contentType: IconContentType, sourceTarget?: BadgeTarget,
): Promise<string | null> {
  const version = crypto.randomUUID();
  const key = examBadgeObjectKey(examId, version);
  const urlPrefix = `/api/exam-badges/${examId}?v=`;
  const url = `${urlPrefix}${version}`;
  await env.BUCKET.put(key, body, { httpMetadata: { contentType } });
  const sourceCheck = sourceTarget ? " AND slug = ? AND badge_source_image_url IS ? AND badge_source_issuer_url IS ?" : "";
  const values = sourceTarget ? [sourceTarget.slug, sourceTarget.badge_source_image_url, sourceTarget.badge_source_issuer_url] : [];
  // On an ambiguous D1 error, the new object may already be referenced.
  const result = await env.DB.prepare(`UPDATE exams SET badge_icon_url = ? WHERE id = ? AND badge_icon_url IS ?${sourceCheck}`)
    .bind(url, examId, previousUrl, ...values).run();
  if (!result.meta.changes) {
    await discardBadge(env.BUCKET, key);
    return null;
  }

  // Numeric legacy URLs still resolve to the original key. Only retire versions
  // created by this writer after the replacement has been committed.
  const previousVersion = previousUrl?.startsWith(urlPrefix) ? previousUrl.slice(urlPrefix.length) : "";
  if (BADGE_VERSION.test(previousVersion)) await discardBadge(env.BUCKET, examBadgeObjectKey(examId, previousVersion));
  return url;
}

export async function importExamBadge(
  env: Env, examId: string, options: { source?: ExamBadgeSource; replace?: boolean } = {},
): Promise<ExamBadgeImportResult> {
  try {
    const { source, replace } = options;
    if (source && !isApprovedBadgeSource(source, env)) return { status: "failed", reason: "source_not_allowed" };
    const target = source
      ? await env.DB.prepare(`UPDATE exams SET badge_source_image_url = ?, badge_source_issuer_url = ? WHERE id = ? RETURNING ${targetColumns}`)
        .bind(source.imageUrl, source.issuerUrl, examId).first<BadgeTarget>()
      : await getBadgeTarget(env.DB, examId);
    if (!target) return { status: "failed", reason: "exam_changed" };
    if (target.badge_icon_url && !replace) return { status: "already_has_badge", badgeIconUrl: target.badge_icon_url };

    const resolvedSource = resolveBadgeSource(target);
    if (!resolvedSource) return { status: "missing_source" };
    const image = await downloadBadge(resolvedSource.imageUrl, env.EXAM_BADGE_IMAGE_HOSTS);
    if ("reason" in image) return { status: "failed", reason: image.reason };
    const badgeIconUrl = await storeExamBadge(env, examId, target.badge_icon_url, image.body, image.type, target);
    return badgeIconUrl ? { status: "imported", badgeIconUrl } : { status: "failed", reason: "exam_changed" };
  } catch {
    console.warn("exam_badge_storage_failed");
    return { status: "failed", reason: "storage_failed" };
  }
}
