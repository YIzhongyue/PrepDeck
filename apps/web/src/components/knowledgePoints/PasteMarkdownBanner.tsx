// Shown AFTER a paste has already landed, as an undo affordance rather than a
// gate. Pasting is the common action and must never wait on a decision, so the
// banner offers only the alternative interpretation of content the reader can
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
    <div role="status" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "0 14px", padding: "10px 14px", border: "1px solid var(--color-accent-300)", borderRadius: 18, background: "var(--color-accent-100)" }}>
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
        <rect x={8} y={3} width={10} height={14} rx={2} />
        <path d="M6 7H5a2 2 0 00-2 2v10a2 2 0 002 2h9a2 2 0 002-2v-1" />
      </svg>
      <span style={{ fontSize: 12.5, color: "var(--color-accent-800)" }}>
        Pasted {wordCount} {wordCount === 1 ? "word" : "words"} as Markdown.
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <button type="button" onClick={onPasteAsPlainText} style={{ padding: "5px 12px", border: 0, borderRadius: 999, background: "var(--color-accent)", color: "var(--color-bg)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}>
          Paste as plain text instead
        </button>
        <button type="button" onClick={onDismiss} style={{ padding: "5px 12px", border: "1px solid var(--color-accent-300)", borderRadius: 999, background: "var(--color-bg)", color: "var(--color-accent-700)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
