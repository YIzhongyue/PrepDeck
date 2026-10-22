import { XClose } from "@untitledui/icons";
import { useI18n } from "../../i18n";

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
  const { t } = useI18n();
  return (
    <div role="status" className="kp-toast">
      <span>{t("kp.paste.pasted", { count: wordCount })}</span>
      <button type="button" className="kp-toast-btn" onMouseDown={e => e.preventDefault()} onClick={onPasteAsPlainText}>
        {t("kp.paste.plain")}
      </button>
      <button type="button" className="kp-toast-close" aria-label={t("common.dismiss")} title={t("common.dismiss")} onMouseDown={e => e.preventDefault()} onClick={onDismiss}>
        <XClose size={16} />
      </button>
    </div>
  );
}
