import { XClose } from "@untitledui/icons";

// Shown AFTER a paste has already landed, as an undo affordance rather than a
// gate. Pasting is the common action and must never wait on a decision, so the
// toast offers only the alternative interpretation of content the reader can
// already see, and withdraws itself on the next edit.
export default function PasteMarkdownBanner({
  wordCount,
  onPasteAsPlainText,
  onDismiss,
}: {
  wordCount: number;
  onPasteAsPlainText: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className="kp-toast">
      <span>Pasted {wordCount} {wordCount === 1 ? "word" : "words"} as formatted Markdown.</span>
      <button type="button" className="kp-toast-btn" onMouseDown={e => e.preventDefault()} onClick={onPasteAsPlainText}>
        Paste as plain text instead
      </button>
      <button type="button" className="kp-toast-close" aria-label="Dismiss" title="Dismiss" onMouseDown={e => e.preventDefault()} onClick={onDismiss}>
        <XClose size={16} />
      </button>
    </div>
  );
}
