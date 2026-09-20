import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export type StatisticsResourceStatus = "loading" | "error" | "ready";

/** Independent request state: missing responses must never mean zero activity. */
export function useStatisticsResource<T>(url: string | null, revision: number) {
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([url, revision, retry]);
  const [result, setResult] = useState<{ key: string; data: T | null; failed: boolean }>();

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    apiFetch<T>(url, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setResult({ key, data, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, data: null, failed: true });
      });
    return () => controller.abort();
  }, [url, key]);

  const current = result?.key === key ? result : undefined;
  const data = current?.data ?? null;
  const failed = current?.failed ?? false;
  const status: StatisticsResourceStatus = failed ? "error" : data === null ? "loading" : "ready";
  return {
    data, failed, status,
    retry: () => setRetry(value => value + 1),
    setData: (value: T) => setResult({ key, data: value, failed: false }),
  };
}
