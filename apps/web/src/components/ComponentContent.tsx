import MarkdownHighlightedText from "./MarkdownHighlightedText";
import type { ContentBlock, QuestionContentModel } from "@prepdeck/shared";
import { allContentBlocks } from "@prepdeck/shared";

export default function ComponentContent({ content, blocks }: { content: QuestionContentModel; blocks?: ContentBlock[] }) {
  return <div className="component-content">{(blocks ?? [...content.stimuli.flatMap(s => s.body), ...content.body]).map(block => {
    switch (block.type) {
      case "heading": return <h4 key={block.id}>{block.text}</h4>;
      case "paragraph": if (block.format === "markdown") return <MarkdownHighlightedText key={block.id} src={block.text} annotations={[]} qid="component" target="stem" show={false} />;
        return <p key={block.id} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{block.text}</p>;
      case "code": return <pre key={block.id} style={{ overflowX: "auto", padding: 12, background: "var(--color-neutral-100)" }}><code>{block.text}</code></pre>;
      case "list": return <ul key={block.id}>{block.entries.map(e => <li key={e.id}><strong>{e.id}</strong> {e.text}</li>)}</ul>;
      case "table": return <div key={block.id} role="region" aria-label={block.caption || "Question table"} tabIndex={0} style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%" }}>
        {block.caption && <caption>{block.caption}</caption>}<thead><tr>{block.columns.map((c, i) => <th key={i} scope="col" style={{ border: "1px solid var(--color-divider)", padding: 8 }}>{c}</th>)}</tr></thead>
        <tbody>{block.rows.map((r, n) => <tr key={n}>{r.map((c, i) => <td key={i} style={{ border: "1px solid var(--color-divider)", padding: 8, whiteSpace: "pre-wrap" }}>{c}</td>)}</tr>)}</tbody>
      </table></div>;
      case "figure": {
        const asset = content.assets.find(a => a.id === block.assetId);
        return <figure key={block.id} style={{ margin: "16px 0" }}>{asset ? <img src={`data:${asset.mediaType};base64,${asset.data}`} alt={block.alt} style={{ maxWidth: "100%", height: "auto" }} /> : <p role="alert">Missing figure: {block.alt}</p>}{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
      }
    }
  })}</div>;
}
export function ComponentOptionContent({ content, optionId }: { content: QuestionContentModel; optionId: string }) {
  const i = content.interaction;
  const options = i.type === "text" ? [] : i.type === "match" ? [...i.left, ...i.right] : i.options;
  const option = options.find(o => o.id === optionId);
  if (!option) return null;
  if (option.body) return <ComponentContent content={content} blocks={option.body} />;
  const entries = allContentBlocks(content).flatMap(b => b.type === "list" ? b.entries : []);
  return <span>{option.memberRefs?.map(id => `${id}: ${entries.find(e => e.id === id)?.text ?? id}`).join("; ")}</span>;
}
