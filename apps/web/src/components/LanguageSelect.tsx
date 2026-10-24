// The interface-language picker (issue #191). Settings shows it as a field;
// the sign-in and legal pages, which have no Settings, show the compact native
// one so a visitor can read them in their language before signing in.
//
// Languages are listed by their own names ("日本語"), which a reader finds
// whatever language the page is currently in.

import { useState } from "react";
import { Select } from "@/components/base/select/select";
import { useI18n } from "../i18n";

export default function LanguageSelect({ "aria-labelledby": labelledBy }: { "aria-labelledby"?: string }) {
  const { t, locale, locales, setLocale } = useI18n();
  const [failed, setFailed] = useState(false);
  const change = (code: string) => {
    setFailed(false);
    void setLocale(code).then((ok) => setFailed(!ok));
  };
  return (
    <Select
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : t("language.label")}
      selectedKey={locale}
      onSelectionChange={(key) => key !== null && change(String(key))}
      items={locales.map((l) => ({ id: l.code, label: l.nativeName }))}
      hint={failed ? t("language.loadFailed") : undefined}
      isInvalid={failed}
    >
      {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
    </Select>
  );
}

/** A small native select for pages outside the signed-in app. */
export function CompactLanguageSelect({ className }: { className?: string }) {
  const { t, locale, locales, setLocale } = useI18n();
  const [failed, setFailed] = useState(false);
  return (
    <span className={className} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--color-neutral-700)" }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx={12} cy={12} r={9} />
          <path d="M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18" />
        </svg>
        <span className="sr-only">{t("language.label")}</span>
        <select
          value={locale}
          onChange={(event) => { setFailed(false); void setLocale(event.target.value).then((ok) => setFailed(!ok)); }}
          style={{ font: "inherit", fontSize: 12, padding: "4px 8px", borderRadius: 999, border: "1px solid var(--color-divider)", background: "var(--color-bg)", color: "var(--color-text)" }}
        >
          {locales.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.nativeName}</option>)}
        </select>
      </label>
      {failed && <span role="alert" style={{ fontSize: 12, color: "var(--color-danger)" }}>{t("language.loadFailed")}</span>}
    </span>
  );
}
