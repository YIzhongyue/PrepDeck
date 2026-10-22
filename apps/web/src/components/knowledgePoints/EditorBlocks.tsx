import { Node } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import MermaidDiagram from "./MermaidDiagram";
import MediaDialog from "./MediaDialog";
import { fencedSource, imageAltText, markdownImage, safeUrl, SOURCE_LANGUAGE } from "./editorMarkdown";
import { useI18n } from "../../i18n";

// ProseMirror handles keydown/paste on the editor root, so a form control
// inside a NodeView competes with it: Backspace at position 0 deletes the NODE
// instead of a character, arrow keys walk the selection out of the field, and
// a paste lands in the document rather than the input. Stopping propagation
// at the control keeps ProseMirror out of text that isn't document content.
const nodeViewInput = {
  onKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
  onPaste: (event: ClipboardEvent) => event.stopPropagation(),
  onMouseDown: (event: MouseEvent) => event.stopPropagation(),
} as const;

function SourceView({ node, updateAttributes }: NodeViewProps) {
  const raw = node.type.name === "rawMarkdown";
  const language = String(node.attrs.language ?? "");
  const [preview, setPreview] = useState(false);
  const { t } = useI18n();
  return (
    <NodeViewWrapper className="kp-source-block">
      <div className="kp-block-controls" contentEditable={false}>
        {raw ? <strong>{t("kp.blocksView.unsupported")}</strong> : (
          <label>{t("kp.blocksView.language")} <input aria-label={t("kp.blocksView.codeLanguage")} value={language} onChange={e => updateAttributes({ language: e.target.value })} {...nodeViewInput} /></label>
        )}
        {!raw && language.toLowerCase() === "mermaid" && (
          <button type="button" onClick={() => setPreview(!preview)}>{t(preview ? "kp.blocksView.editDiagram" : "kp.blocksView.previewDiagram")}</button>
        )}
      </div>
      <pre hidden={preview}><NodeViewContent<"code"> as="code" aria-label={t(raw ? "kp.blocksView.unsupportedSource" : "kp.blocksView.codeSource")} /></pre>
      {preview && <div contentEditable={false}><MermaidDiagram source={node.textContent} /></div>}
    </NodeViewWrapper>
  );
}

export const RawMarkdown = Node.create({
  name: "rawMarkdown", group: "block", content: "text*", marks: "", code: true, defining: true,
  parseHTML: () => [{ tag: "pre[data-kp-source]", preserveWhitespace: "full" }],
  renderHTML: () => ["pre", { "data-kp-source": "true" }, ["code", {}, 0]],
  renderMarkdown: node => (node.content ?? []).map(n => n.text ?? "").join(""),
  addNodeView: () => ReactNodeViewRenderer(SourceView),
});

export const VisualCodeBlock = CodeBlock.extend({
  parseMarkdown: (token, helpers) => helpers.createNode(token.lang === SOURCE_LANGUAGE ? "rawMarkdown" : "codeBlock",
    token.lang === SOURCE_LANGUAGE ? undefined : { language: token.lang || null }, token.text ? [helpers.createTextNode(token.text)] : []),
  renderMarkdown: node => fencedSource((node.content ?? []).map(n => n.text ?? "").join(""), node.attrs?.language ?? ""),
  addNodeView: () => ReactNodeViewRenderer(SourceView),
});

function ImageView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const [large, setLarge] = useState(false);
  const { t } = useI18n();
  const src = String(node.attrs.src ?? "");
  return (
    <NodeViewWrapper className="kp-image-block" contentEditable={false}>
      {safeUrl(src) ? <button type="button" className="kp-image-open" aria-label={t("kp.blocksView.viewLargerImage")} onClick={() => setLarge(true)}><img src={src} alt={node.attrs.alt ?? ""} /></button> : <p role="alert">{t("kp.blocksView.badImageUrl")}</p>}
      <div className="kp-block-controls">
        <label>{t("kp.blocksView.altText")} <input aria-label={t("kp.blocksView.imageAltText")} value={node.attrs.alt ?? ""} onChange={e => updateAttributes({ alt: e.target.value })} {...nodeViewInput} /></label>
        <button type="button" onClick={deleteNode}>{t("kp.blocksView.removeImage")}</button>
      </div>
      {large && <MediaDialog kind="image" onClose={() => setLarge(false)}>
        <img src={src} alt={node.attrs.alt ?? ""} />
      </MediaDialog>}
    </NodeViewWrapper>
  );
}

export const VisualImage = Image.extend({
  parseMarkdown: (token, helpers) => helpers.createNode("image", { src: token.href, title: token.title, alt: imageAltText(token) }),
  renderMarkdown: node => markdownImage(node.attrs?.alt ?? "", node.attrs?.src ?? "", node.attrs?.title),
  addNodeView: () => ReactNodeViewRenderer(ImageView),
});
