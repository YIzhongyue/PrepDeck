import { useState } from "react";

export default function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ margin: "0 0 16px", borderRadius: 16, overflow: "hidden", border: "1px solid var(--color-divider)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "var(--color-neutral-100)", borderBottom: "1px solid var(--color-divider)" }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--color-text-muted)" }}>
          {lang || "text"}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(text).catch(() => {});
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          style={{ marginLeft: "auto", padding: "3px 9px", border: 0, borderRadius: 999, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11.5, color: "var(--color-accent-700)", fontWeight: 600 }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={{ margin: 0, padding: "14px 18px", overflowX: "auto", background: "var(--color-neutral-900)", color: "#e6edf7", fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, lineHeight: 1.65 }}>
        <code>{text}</code>
      </pre>
    </div>
  );
}
