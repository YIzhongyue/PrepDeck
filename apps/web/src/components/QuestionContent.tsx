import MarkdownHighlightedText from "./MarkdownHighlightedText";
import type { ComponentProps } from "react";

// Markdown v1 is stored as plain strings. Future content versions should adapt
// to this boundary, with controlled node renderers instead of executable HTML.
export default function QuestionContent({ src, ...props }: { src: string } & Partial<Omit<ComponentProps<typeof MarkdownHighlightedText>, "src">>) {
  return <MarkdownHighlightedText src={src} sourceCoordinates annotations={[]} qid="preview" target="stem" show={false} {...props} />;
}
