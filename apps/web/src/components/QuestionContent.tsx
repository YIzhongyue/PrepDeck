import type { QuestionContentModel } from "@prepdeck/shared";
import ComponentContent, { ComponentOptionContent } from "./ComponentContent";
import MarkdownHighlightedText from "./MarkdownHighlightedText";
import type { ComponentProps } from "react";

// Markdown v1 is stored as plain strings. Future content versions should adapt
// to this boundary, with controlled node renderers instead of executable HTML.
export default function QuestionContent({ src, content, optionId, ...props }: { src: string; content?: QuestionContentModel; optionId?: string } & Partial<Omit<ComponentProps<typeof MarkdownHighlightedText>, "src">>) {
  if (content) return optionId ? <ComponentOptionContent content={content} optionId={optionId} /> : <ComponentContent content={content} />;
  return <MarkdownHighlightedText src={src} sourceCoordinates annotations={[]} qid="preview" target="stem" show={false} {...props} />;
}
