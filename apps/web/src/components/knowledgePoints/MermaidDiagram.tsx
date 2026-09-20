// implementation — renders one ```mermaid fenced block. Errors and rendering are
// isolated per-block (a bad diagram never blocks the rest of the note from
// rendering), and mermaid runs with restrictive settings so private diagram
// source is never sent to an external service and no click-handler/script
// content in a diagram label can execute.

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import MediaDialog from "./MediaDialog";

let renderQueue = Promise.resolve();
const MAX_SOURCE_LENGTH = 12000;

let counter = 0;

export default function MermaidDiagram({ source }: { source: string }) {
  const idRef = useRef(`kp-mermaid-${++counter}`);
  const hostRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [large, setLarge] = useState(false);
  const [theme, setTheme] = useState("neutral");

  useEffect(() => {
    const host = hostRef.current?.closest("[data-pd-theme]");
    const update = () => setTheme(host?.getAttribute("data-pd-theme") === "dusk" ? "dark" : "neutral");
    update();
    if (!host) return;
    const observer = new MutationObserver(update);
    observer.observe(host, { attributes: true, attributeFilter: ["data-pd-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (source.length > MAX_SOURCE_LENGTH || source.split("\n").length > 250) {
      setSvg(null); setError("Diagram is too large. Use at most 12,000 characters and 250 lines."); return;
    }
    // Debounced so retyping a diagram's source while it's open doesn't fire
    // overlapping mermaid.render() calls.
    const timer = window.setTimeout(() => {
      renderQueue = renderQueue.catch(() => {}).then(async () => {
        if (cancelled) return;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme as "neutral" | "dark", maxTextSize: MAX_SOURCE_LENGTH, maxEdges: 150, suppressErrorRendering: true, fontFamily: "Figtree, system-ui, sans-serif" });
        await mermaid.render(idRef.current, source)
        .then(({ svg: rendered }) => {
          if (cancelled) return;
          setSvg(rendered);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setSvg(null);
          setError(err instanceof Error ? err.message : "Diagram failed to render");
        });
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, theme]);

  const showSource = mode === "source" || !!error || !svg;

  return (
    <div ref={hostRef} style={{ margin: "0 0 16px", border: `1px solid ${error ? "var(--color-danger-border)" : "var(--color-divider)"}`, borderRadius: 16, overflow: "hidden" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: error ? "9px 14px" : "8px 12px", flexWrap: "wrap",
          background: error ? "var(--color-danger-bg)" : "var(--color-neutral-100)",
          borderBottom: "1px solid var(--color-divider)",
          color: error ? "var(--color-danger-text)" : "inherit",
        }}
      >
        {error ? (
          <span style={{ fontSize: 12, fontWeight: 600 }}>Diagram didn&rsquo;t render — {error}</span>
        ) : (
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>mermaid</span>
        )}
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 3, padding: 3, border: "1px solid var(--color-divider)", borderRadius: 999, background: "var(--color-bg)" }}>
          <button
            type="button"
            onClick={() => setMode("preview")}
            disabled={!!error}
            style={{
              padding: "4px 12px", border: 0, borderRadius: 999, cursor: error ? "not-allowed" : "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600,
              background: mode === "preview" && !error ? "var(--color-accent)" : "transparent", color: mode === "preview" && !error ? "var(--color-bg)" : "inherit", opacity: error ? 0.5 : 1,
            }}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setMode("source")}
            style={{
              padding: "4px 12px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600,
              background: showSource ? "var(--color-accent)" : "transparent", color: showSource ? "var(--color-bg)" : "inherit",
            }}
          >
            Source
          </button>
        </div>
      </div>
      {showSource ? (
        <pre style={{ margin: 0, padding: "14px 16px", overflowX: "auto", background: "var(--color-surface)", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.7 }}>{source}</pre>
      ) : (
        // The enlarged copy below renders this exact markup. Mermaid's SVG
        // carries its own element ids and references them internally (url(#…)
        // for arrowheads and markers), so mounting both at once would put
        // duplicate ids in the document and let the copy's references resolve
        // against this one. Exactly one instance is ever mounted.
        <div style={{ padding: 18, overflowX: "auto" }} dangerouslySetInnerHTML={large ? undefined : { __html: svg! }} />
      )}
      {svg && <button type="button" className="btn btn-secondary" onClick={() => setLarge(true)}>View larger diagram</button>}
      {large && svg && <MediaDialog label="diagram" onClose={() => setLarge(false)}>
        <div style={{ minWidth: 700 }} dangerouslySetInnerHTML={{ __html: svg }} />
      </MediaDialog>}
    </div>
  );
}
