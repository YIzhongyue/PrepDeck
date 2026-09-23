import type { QuestionContentModel } from "@prepdeck/shared";
import ComponentContent, { ComponentOptionContent } from "./ComponentContent";
import MarkdownHighlightedText from "./MarkdownHighlightedText";
import type { ComponentProps } from "react";

// Lossless legacy export wrappers retain the original Markdown coordinates.
// Structured blocks use their renderer rather than unrelated string offsets.
export default function QuestionContent({ src, content, optionId, ...props }: { src: string; content?: QuestionContentModel; optionId?: string } & Partial<Omit<ComponentProps<typeof MarkdownHighlightedText>, "src">>) {
  if (content) {
    const interaction = content.interaction;
    const options = interaction.type === "text" ? [] : interaction.type === "match" ? [...interaction.left, ...interaction.right] : interaction.options;
    const blocks = optionId ? options.find(option => option.id === optionId)?.body : content.stimuli.length ? undefined : content.body;
    const block = blocks?.length === 1 ? blocks[0] : undefined;
    const sameMarkdown = block?.type === "paragraph" && block.format === "markdown" && block.text === src;
    if (!sameMarkdown) return optionId ? <ComponentOptionContent content={content} optionId={optionId} /> : <ComponentContent content={content} />;
  }
  return <MarkdownHighlightedText src={src} sourceCoordinates reflowProse annotations={[]} qid="preview" target="stem" show={false} {...props} />;
}
