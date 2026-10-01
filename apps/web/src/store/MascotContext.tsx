import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_MASCOT_STYLE, isMascotStyle, type MascotStyle, type SiteAppearance } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";

type LoadStatus = "loading" | "ready" | "failed";
interface MascotContextValue {
  style: MascotStyle;
  status: LoadStatus;
  refresh: () => Promise<void>;
  save: (style: MascotStyle) => Promise<void>;
}
// Components rendered independently (including existing fixtures) retain the
// default decoration. The application mounts the provider above its auth gate.
const MascotContext = createContext<MascotContextValue>({
  style: DEFAULT_MASCOT_STYLE, status: "loading", refresh: async () => {},
  save: async () => { throw new Error("Site appearance is unavailable"); },
});

export function MascotProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState<MascotStyle>(DEFAULT_MASCOT_STYLE);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const generation = useRef(0);
  const read = useRef<AbortController | null>(null);
  const saving = useRef(false);

  const refresh = useCallback(async () => {
    if (saving.current) return;
    const current = ++generation.current;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setStatus("loading");
    try {
      // A decorative public read must never announce session loss or delay login.
      const response = await fetch("/api/appearance", { cache: "no-store", credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error("Appearance read failed");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("mascotStyle" in data) || !isMascotStyle(data.mascotStyle)) {
        throw new Error("Invalid appearance response");
      }
      if (current === generation.current) { setStyle(data.mascotStyle); setStatus("ready"); }
    } catch {
      // Keep the last valid style (or the initial default) on network failure.
      if (current === generation.current) setStatus("failed");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const save = useCallback(async (next: MascotStyle) => {
    if (saving.current) throw new Error("A save is already in progress");
    saving.current = true;
    // In-flight reads must not replace the result of this save.
    const current = ++generation.current;
    read.current?.abort();
    try {
      const data = await apiFetch<SiteAppearance>("/api/admin/appearance", {
        method: "PUT", body: JSON.stringify({ mascotStyle: next }), signal: AbortSignal.timeout(15000),
      });
      if (!isMascotStyle(data.mascotStyle)) throw new Error("Invalid appearance response. Please reload and retry.");
      if (current === generation.current) { setStyle(data.mascotStyle); setStatus("ready"); }
    } finally {
      saving.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { ++generation.current; read.current?.abort(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  return <MascotContext.Provider value={{ style, status, refresh, save }}>{children}</MascotContext.Provider>;
}

export function useMascot() { return useContext(MascotContext); }
