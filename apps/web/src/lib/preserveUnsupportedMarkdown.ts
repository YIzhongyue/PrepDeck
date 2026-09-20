// implementation — react-markdown (deliberately used without rehype-raw, since
// rendering raw user HTML would be an XSS risk, and implementation both call for
// safe rendering) silently drops raw HTML nodes from the parsed Markdown
// tree. Per implementation, unsupported Markdown should be preserved as an editable
// source/fallback block rather than dropped. This remark plugin rewrites
// `html` nodes into code nodes so the preview shows them as literal text.
//
// Both block and inline raw HTML are now covered, which is a change from the
// original scope cut. Block-level HTML — a node whose parent is a block
// container (root, blockquote, list item) — becomes a `code` node tagged with
// a special language, which MarkdownPreview.tsx's `pre` renderer labels as a
// "kept as source" block. Inline HTML (e.g. a stray `<br>` mid-sentence)
// becomes `inlineCode` instead: it cannot become a `code` block without
// violating mdast-to-hast's phrasing-content constraints, and the earlier
// behaviour of leaving it to be dropped meant a note could silently lose
// content on a round trip through the preview. Neither form is ever
// rendered as markup — the value is escaped text in both cases.
export const UNSUPPORTED_MARKDOWN_LANG = "unsupported-markdown";

const PHRASING_CONTAINER_TYPES = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "linkReference", "tableCell"]);

interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
  [key: string]: unknown;
}

function walk(node: MdastNode): void {
  if (!node.children) return;
  const isPhrasingContainer = PHRASING_CONTAINER_TYPES.has(node.type);
  node.children = node.children.map((child) => {
    if (child.type === "html") {
      return isPhrasingContainer ? { type: "inlineCode", value: child.value ?? "" }
        : { type: "code", lang: UNSUPPORTED_MARKDOWN_LANG, meta: null, value: child.value ?? "" };
    }
    walk(child);
    return child;
  });
}

export function preserveUnsupportedMarkdown() {
  return (tree: MdastNode) => {
    walk(tree);
  };
}
