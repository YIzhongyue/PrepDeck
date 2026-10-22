import BrandLogo from "./BrandLogo";
import { CompactLanguageSelect } from "./LanguageSelect";
import { useI18n } from "../i18n";

export default function LegalHeader() {
  const { t, locale } = useI18n();
  return (
    <>
    <header className="legal-header">
      <a href="/" aria-label={t("legal.home")}><BrandLogo /></a>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <CompactLanguageSelect />
        <a className="legal-header-back" href="/">{t("legal.back")} <span aria-hidden="true">→</span></a>
      </span>
    </header>
    {/* The policy text itself is English only; it is the version that applies. */}
    {locale !== "en" && <p role="note" style={{ margin: "0 auto", maxWidth: 1120, padding: "8px 24px", fontSize: 13, color: "var(--color-neutral-700)" }}>{t("legal.englishOnly")}</p>}
    </>
  );
}
