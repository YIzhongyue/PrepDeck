// implementation — renders saved/edited Markdown for reading. `pre` is overridden
// to detect a ```mermaid fence (dispatches to MermaidDiagram), a block of
// preserved-but-unsupported raw HTML (implementation — see
// lib/preserveUnsupportedMarkdown.ts), or any other fenced code block
// (CodeBlock with a copy button); everything else uses GFM (tables,
// strikethrough, task lists) via remark-gfm. Images open an enlarged
// lightbox on click (implementation).

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "./MermaidDiagram";
import CodeBlock from "./CodeBlock";
import { UNSUPPORTED_MARKDOWN_LANG, preserveUnsupportedMarkdown } from "../../lib/preserveUnsupportedMarkdown";

function PreRenderer(props: { children?: React.ReactNode }) {
  const child = React.Children.only(props.children) as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
  const className = child.props.className || "";
  const match = /language-([\w-]+)/.exec(className);
  const lang = match?.[1] ?? "";
  const text = String(child.props.children ?? "").replace(/\n$/, "");

  if (lang === UNSUPPORTED_MARKDOWN_LANG) {
    return (
      <div style={{ margin: "0 0 16px", border: "1px dashed var(--color-divider)", borderRadius: 16, background: "var(--color-neutral-100)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px dashed var(--color-divider)" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.6 }}>Unsupported Markdown — kept as source</span>
        </div>
        <pre style={{ margin: 0, padding: "12px 16px", overflowX: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.7, opacity: 0.75 }}>{text}</pre>
      </div>
    );
  }
  if (lang.toLowerCase() === "mermaid") return <MermaidDiagram source={text} />;
  return <CodeBlock lang={lang} text={text} />;
}

export default function MarkdownPreview({ source }: { source: string }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (!source.trim()) {
    return <p style={{ opacity: 0.5, fontStyle: "italic", margin: 0 }}>Nothing to preview yet.</p>;
  }

  return (
    <div style={{ fontSize: 15.5, lineHeight: 1.72 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, preserveUnsupportedMarkdown]}
        components={{
          a: (p) => <a href={p.href} target="_blank" rel="noreferrer noopener">{p.children}</a>,
          img: (p) => (
            <img
              src={p.src}
              alt={p.alt}
              onClick={() => p.src && setLightbox(p.src)}
              style={{ borderRadius: 12, maxWidth: "100%", margin: "8px 0", cursor: "zoom-in" }}
            />
          ),
          table: (p) => (
            <div style={{ overflowX: "auto", margin: "0 0 16px", border: "1px solid var(--color-divider)", borderRadius: 16 }}>
              <table style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 13.5 }}>{p.children}</table>
            </div>
          ),
          th: (p) => (
            <th style={{ textAlign: "left", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 60%, transparent)", padding: "10px 14px", background: "var(--color-neutral-100)", borderBottom: "1px solid var(--color-divider)" }}>
              {p.children}
            </th>
          ),
          td: (p) => <td style={{ padding: "10px 14px", borderBottom: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)" }}>{p.children}</td>,
          blockquote: (p) => (
            <div style={{ margin: "0 0 16px", padding: "14px 20px", borderLeft: "3px solid var(--color-accent)", borderRadius: "0 16px 16px 0", background: "var(--color-accent-100)" }}>
              {p.children}
            </div>
          ),
          code: (p) => (
            <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, background: "var(--color-neutral-100)", padding: "1px 5px", borderRadius: 5 }}>
              {p.children}
            </code>
          ),
          pre: PreRenderer,
        }}
      >
        {source}
      </ReactMarkdown>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 18, background: "color-mix(in srgb, var(--color-neutral-900) 78%, transparent)", cursor: "zoom-out" }}
        >
          <img src={lightbox} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", borderRadius: 8, boxShadow: "var(--pd-shadow-lg)" }} />
        </div>
      )}
    </div>
  );
}
