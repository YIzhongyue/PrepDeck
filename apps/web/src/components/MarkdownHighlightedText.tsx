import type { ReactElement } from "react";
import HighlightedText from "./HighlightedText";
import { mdSegsFor } from "../lib/annotations";
import { parseMarkdown } from "../lib/markdown";
import type { Annotation, AnnotationTarget } from "../types";

// docs/requirements/ai-explanations.md's AI explanations render as Markdown, while staying fully
// annotatable (docs/requirements/review-notes-and-annotations.md, FR-8.1) via the exact same character-offset
// mechanism used for the question stem/options (capture()/apply() in
// PrepDeckContext.tsx don't know or care that this content came from
// lib/markdown.ts — they only ever look at `data-off` attributes, which
// HighlightedText still renders on every leaf span, same as always).
export default function MarkdownHighlightedText({
  src, annotations, qid, target, show, onMouseUp, onRemoveMark, sourceCoordinates = false, reflowProse = false
}: {
  src: string;
  sourceCoordinates?: boolean;
  reflowProse?: boolean;
  annotations: Annotation[];
  qid: string;
  target: AnnotationTarget;
  show: boolean;
  onMouseUp?: () => void;
  onRemoveMark?: (id: string) => void;
}) {
  const parsed = parseMarkdown(src, sourceCoordinates, reflowProse);
  const blockSegs = mdSegsFor(parsed, annotations, qid, target, show);

  const elements: ReactElement[] = [];
  let i = 0;
  while (i < blockSegs.length) {
    const entry = blockSegs[i]!;
    if (entry.block.type === "li" || entry.block.type === "oli") {
      const listType = entry.block.type;
      const items: typeof blockSegs = [];
      while (i < blockSegs.length && blockSegs[i]!.block.type === listType) {
        items.push(blockSegs[i]!);
        i++;
      }
      const Tag = listType === "li" ? "ul" : "ol";
      elements.push(
        <Tag key={`list-${items[0]!.block.start}`} style={{ margin: "4px 0 8px", paddingLeft: 20 }}>
          {items.map(({ block, segs }) => (
            <li key={block.start} style={{ marginBottom: 3 }}>
              <HighlightedText segs={segs} onRemoveMark={onRemoveMark} />
            </li>
          ))}
        </Tag>
      );
      continue;
    }

    const { block, segs } = entry;
    const key = block.start;
    if (block.type === "hr") {
      elements.push(<hr key={`hr-${key}`} style={{ border: "none", borderTop: "1px solid var(--color-divider)", margin: "10px 0" }} />);
    } else if (block.type === "h1") {
      elements.push(<h4 key={key} style={{ margin: "10px 0 6px", fontSize: 16 }}><HighlightedText segs={segs} onRemoveMark={onRemoveMark} /></h4>);
    } else if (block.type === "h2") {
      elements.push(<h5 key={key} style={{ margin: "10px 0 6px", fontSize: 14.5, fontWeight: 700 }}><HighlightedText segs={segs} onRemoveMark={onRemoveMark} /></h5>);
    } else if (block.type === "h3") {
      elements.push(<h6 key={key} style={{ margin: "8px 0 4px", fontSize: 13.5, fontWeight: 700 }}><HighlightedText segs={segs} onRemoveMark={onRemoveMark} /></h6>);
    } else if (block.type === "code") {
      elements.push(
        <pre
          key={key}
          style={{ margin: "6px 0", padding: "10px 12px", borderRadius: 12, background: "var(--color-neutral-100)", overflowX: "auto", fontSize: 12.5, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
        >
          <code><HighlightedText segs={segs} onRemoveMark={onRemoveMark} /></code>
        </pre>
      );
    } else {
      elements.push(<p key={key} style={{ margin: "0 0 8px" }}><HighlightedText segs={segs} onRemoveMark={onRemoveMark} /></p>);
    }
    i++;
  }

  return (
    <div onMouseUp={onMouseUp} style={{ fontSize: 13.5, lineHeight: 1.65 }}>
      {elements}
    </div>
  );
}
