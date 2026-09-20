import BrandLogo from "../components/BrandLogo";
import LegalHeader from "../components/LegalHeader";

const sections = [
  ["agreement", "Agreement"], ["eligibility", "Eligibility & accounts"],
  ["service", "Using PrepDeck"], ["content", "Your content"],
  ["ai", "AI-assisted features"], ["acceptable-use", "Acceptable use"],
  ["ownership", "Ownership"], ["availability", "Service availability"],
  ["disclaimers", "Disclaimers"], ["liability", "Liability"],
  ["termination", "Termination"], ["changes", "Changes & contact"]
] as const;

function LineIcon({ name }: { name: "book" | "spark" | "balance" | "check" }) {
  const paths = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/></>,
    spark: <><path d="m12 3-1.2 4.3a5 5 0 0 1-3.5 3.5L3 12l4.3 1.2a5 5 0 0 1 3.5 3.5L12 21l1.2-4.3a5 5 0 0 1 3.5-3.5L21 12l-4.3-1.2a5 5 0 0 1-3.5-3.5z"/></>,
    balance: <><path d="M12 3v18M5 6h14M5 6l-3 6h6L5 6Zm14 0-3 6h6l-3-6ZM8 21h8"/></>,
    check: <><path d="M20 6 9 17l-5-5"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function TermsOfService() {
  return <div className="terms-page" data-pd-theme="light">
    <LegalHeader />

    <main>
      <section className="terms-hero">
        <div className="terms-hero-copy">
          <span className="terms-kicker"><span>Legal, made readable</span></span>
          <h1>The ground rules for<br/><em>learning well.</em></h1>
          <p>These terms explain what you can expect from PrepDeck—and what we ask from you in return.</p>
          <div className="terms-meta"><span>Effective September 7, 2026</span><span>•</span><span>About 8 minutes to read</span></div>
        </div>
        <div className="terms-visual" aria-hidden="true">
          <div className="terms-card terms-card-back"><span>12</span><small>clear sections</small></div>
          <div className="terms-card terms-card-front"><div className="terms-card-icon"><LineIcon name="book" /></div><strong>Terms of<br/>Service</strong><i><LineIcon name="check" /></i></div>
          <span className="terms-star star-a">✦</span><span className="terms-star star-b">✦</span>
        </div>
      </section>

      <section className="terms-summary" aria-label="Terms at a glance">
        <div className="terms-summary-intro"><span>At a glance</span><h2>A fair deal,<br/>in plain English.</h2></div>
        <article><span className="terms-summary-icon blue"><LineIcon name="book" /></span><div><h3>Learn responsibly</h3><p>Use PrepDeck for legitimate study and respect other learners.</p></div></article>
        <article><span className="terms-summary-icon mint"><LineIcon name="spark" /></span><div><h3>AI needs judgment</h3><p>AI explanations can be wrong. Verify anything important.</p></div></article>
        <article><span className="terms-summary-icon coral"><LineIcon name="balance" /></span><div><h3>You own your work</h3><p>Your notes remain yours; you let us process them to run the service.</p></div></article>
      </section>

      <div className="terms-layout">
        <aside className="terms-toc"><p>In these terms</p><nav>{sections.map(([id, label], index) => <a href={`#${id}`} key={id}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}</nav><div className="terms-toc-help"><strong>Need a hand?</strong><p>Contact the administrator who invited you.</p></div></aside>
        <article className="terms-content">
          <section id="agreement"><span className="terms-number">01</span><h2>Agreement to these terms</h2><p>These Terms of Service are an agreement between you and the operator of your PrepDeck workspace. By accessing or using PrepDeck, you agree to these terms and our <a href="/privacy">Privacy Policy</a>. If you do not agree, please do not use the service.</p><div className="terms-callout"><strong>First things first</strong><p>Your workspace may have additional rules set by its administrator. If those rules conflict with these terms, these terms govern your use of PrepDeck.</p></div></section>
          <section id="eligibility"><span className="terms-number">02</span><h2>Eligibility &amp; accounts</h2><p>You must be at least 13 years old and authorized by a PrepDeck workspace administrator. If local law requires a higher minimum age, that higher age applies. You are responsible for your Google account, your device, and all activity under your PrepDeck account.</p><ul><li>Provide accurate account information and keep it current.</li><li>Do not share access or impersonate another person.</li><li>Tell your administrator promptly if you suspect unauthorized access.</li></ul></section>
          <section id="service"><span className="terms-number">03</span><h2>Using PrepDeck</h2><p>PrepDeck provides practice questions, mock exams, learning tools, notes, progress tracking, and optional AI-assisted explanations. Features may differ between workspaces or change as the product evolves. A PrepDeck score is a study aid—not an official exam result, credential, or guarantee of success.</p></section>
          <section id="content"><span className="terms-number">04</span><h2>Your content</h2><p>You retain ownership of notes, annotations, imports, and other content you submit. You give us a limited, worldwide, non-exclusive license to host, copy, process, and display that content solely to operate, secure, and improve PrepDeck.</p><p>You confirm that you have the right to upload your content. Shared notes and materials may be visible to your group and workspace administrators, so do not submit confidential information you are not permitted to share.</p></section>
          <section id="ai"><span className="terms-number">05</span><h2>AI-assisted features</h2><p>AI explanations are optional. When you request one, relevant question content and instructions are sent to the provider and model you select. Provider terms may also apply. You are responsible for any provider charges associated with your API key.</p><div className="terms-callout mint"><strong>Use your own judgment</strong><p>AI output may be incomplete, inaccurate, or outdated. Do not rely on it as professional advice or as the sole source for a high-stakes decision.</p></div></section>
          <section id="acceptable-use"><span className="terms-number">06</span><h2>Acceptable use</h2><p>Keep PrepDeck useful and safe. You may not:</p><ul><li>Break the law, violate another person’s rights, or upload harmful or infringing material.</li><li>Probe, disrupt, overload, bypass, or attempt unauthorized access to the service.</li><li>Use bots or automated extraction without written permission.</li><li>Copy, sell, or redistribute question banks or service content unless you have permission.</li><li>Use PrepDeck to develop malware, facilitate cheating, or misrepresent exam credentials.</li></ul></section>
          <section id="ownership"><span className="terms-number">07</span><h2>PrepDeck ownership</h2><p>PrepDeck’s software, design, branding, and service-provided content are owned by the service operator or its licensors and are protected by applicable intellectual-property laws. These terms give you a personal, limited, revocable right to use the service; they do not transfer ownership to you.</p><p>Third-party exam names and trademarks belong to their respective owners. PrepDeck is not affiliated with or endorsed by certification providers unless expressly stated.</p></section>
          <section id="availability"><span className="terms-number">08</span><h2>Service availability</h2><p>We aim to keep PrepDeck reliable, but the service may occasionally be unavailable for maintenance, security, technical failures, or circumstances outside our control. We may add, modify, or discontinue features. Where practical, we will provide reasonable notice of material changes.</p></section>
          <section id="disclaimers"><span className="terms-number">09</span><h2>Disclaimers</h2><p>To the extent permitted by law, PrepDeck is provided “as is” and “as available,” without warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, or uninterrupted availability. We do not guarantee that any question, answer, explanation, or progress metric is error-free.</p></section>
          <section id="liability"><span className="terms-number">10</span><h2>Limitation of liability</h2><p>To the fullest extent permitted by law, the service operator and workspace administrators will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost data, profits, opportunities, or exam fees arising from your use of PrepDeck. Nothing in these terms excludes liability that cannot legally be excluded.</p></section>
          <section id="termination"><span className="terms-number">11</span><h2>Suspension &amp; termination</h2><p>You may stop using PrepDeck at any time. Your administrator may suspend or remove access, and we may restrict access when reasonably necessary to protect users, comply with law, prevent harm, or address a breach of these terms. Provisions that by their nature should survive termination—including ownership, disclaimers, and liability limits—will survive.</p></section>
          <section id="changes"><span className="terms-number">12</span><h2>Changes &amp; questions</h2><p>We may update these terms as PrepDeck changes. We will revise the effective date and provide additional notice when changes are material. Continued use after updated terms take effect means you accept them.</p><p>Questions about these terms should go to the administrator who invited you to the workspace. They can answer account questions or route your request to the service operator.</p><div className="terms-actions"><a className="terms-primary" href="/">Return to PrepDeck <span>→</span></a><a href="/privacy">Read our Privacy Policy</a></div></section>
        </article>
      </div>
    </main>
    <footer className="terms-footer"><BrandLogo /><p>Thoughtful tools for focused learning.</p><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav><p>© 2026 PrepDeck</p></footer>
  </div>;
}
