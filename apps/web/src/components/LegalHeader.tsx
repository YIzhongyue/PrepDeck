import BrandLogo from "./BrandLogo";

export default function LegalHeader() {
  return (
    <header className="legal-header">
      <a href="/" aria-label="PrepDeck home"><BrandLogo /></a>
      <a className="legal-header-back" href="/">Back to PrepDeck <span aria-hidden="true">→</span></a>
    </header>
  );
}
