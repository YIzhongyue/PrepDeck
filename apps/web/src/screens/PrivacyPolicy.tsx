import BrandLogo from "../components/BrandLogo";
import LegalHeader from "../components/LegalHeader";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "collect", label: "Information we collect" },
  { id: "use", label: "How we use information" },
  { id: "share", label: "How information is shared" },
  { id: "ai", label: "AI features & API keys" },
  { id: "storage", label: "Storage & security" },
  { id: "choices", label: "Your choices" },
  { id: "retention", label: "Retention" },
  { id: "children", label: "Children's privacy" },
  { id: "changes", label: "Changes to this policy" },
  { id: "contact", label: "Contact" }
];

function Icon({ name }: { name: "shield" | "key" | "eye" }) {
  const paths = {
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l2 2M17 6l2 2"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function PrivacyPolicy() {
  return (
    <div className="privacy-page" data-pd-theme="light">
      <LegalHeader />

      <main>
        <section className="privacy-hero">
          <div className="privacy-hero-copy">
            <span className="privacy-eyebrow"><span>●</span> Your privacy, clearly explained</span>
            <h1>Privacy should never be<br />a <em>pop quiz.</em></h1>
            <p>Here’s what PrepDeck collects, why we need it, and the choices you have—written for people, not lawyers.</p>
            <div className="privacy-updated"><span>Last updated</span><strong>September 7, 2026</strong></div>
          </div>
          <div className="privacy-illustration" aria-hidden="true">
            <div className="privacy-orbit privacy-orbit-one"/><div className="privacy-orbit privacy-orbit-two"/>
            <div className="privacy-shield"><Icon name="shield" /></div>
            <span className="privacy-spark spark-one">✦</span><span className="privacy-spark spark-two">✦</span>
            <span className="privacy-dot dot-one"/><span className="privacy-dot dot-two"/>
          </div>
        </section>

        <section className="privacy-promises" aria-label="Privacy highlights">
          <article><span className="promise-icon blue"><Icon name="shield" /></span><div><h2>Your work stays yours</h2><p>Your study history is used to power your PrepDeck experience—not to sell ads.</p></div></article>
          <article><span className="promise-icon green"><Icon name="key" /></span><div><h2>Keys stay in your control</h2><p>Provider API keys are relayed for your request and are never stored on our servers.</p></div></article>
          <article><span className="promise-icon peach"><Icon name="eye" /></span><div><h2>No hidden tracking</h2><p>We use essential technology to run the service, not cross-site advertising trackers.</p></div></article>
        </section>

        <div className="privacy-layout">
          <aside className="privacy-toc"><p>On this page</p><nav>{sections.map((section, i) => <a key={section.id} href={`#${section.id}`} className={i === 0 ? "active" : ""}><span>{String(i + 1).padStart(2, "0")}</span>{section.label}</a>)}</nav></aside>

          <article className="privacy-content">
            <section id="overview"><span className="section-number">01</span><h2>Overview</h2><p>PrepDeck is an invite-only practice and quiz platform. This policy explains how information is handled when you sign in, study, use AI-assisted explanations, or administer a PrepDeck workspace.</p><div className="privacy-note"><strong>The short version</strong><p>We collect only what is needed to provide, secure, and improve the service. We do not sell your personal information.</p></div></section>
            <section id="collect"><span className="section-number">02</span><h2>Information we collect</h2><h3>Account information</h3><p>When you sign in with Google, we receive basic profile information such as your email address, display name, and profile image. We use this to verify that you are an authorized user and to identify your account.</p><h3>Study activity and content</h3><p>We store your answers, scores, bookmarks, learning progress, annotations, notes, preferences, and activity needed to provide study features. Notes you mark as shared can be seen by members of your group and may be reviewed by administrators.</p><h3>Technical information</h3><p>We may process essential request data such as IP address, browser information, timestamps, and security logs to operate, troubleshoot, and protect PrepDeck. Essential cookies keep you signed in.</p></section>
            <section id="use"><span className="section-number">03</span><h2>How we use information</h2><ul><li>Provide your account, personalized progress, practice, and exam features.</li><li>Authenticate users, enforce permissions, and prevent misuse.</li><li>Maintain reliability, diagnose errors, and improve the experience.</li><li>Generate AI explanations when you explicitly request them.</li><li>Meet applicable legal obligations and protect users and the service.</li></ul></section>
            <section id="share"><span className="section-number">04</span><h2>How information is shared</h2><p>We do not sell or rent personal information. Information may be shared with infrastructure and authentication providers that help operate PrepDeck, with AI providers at your direction, with workspace administrators where necessary, or when required by law. These providers process information under their own terms and privacy policies.</p></section>
            <section id="ai"><span className="section-number">05</span><h2>AI features &amp; API keys</h2><p>AI explanations are optional and use the provider and model you select. Your question context and instructions are sent to that provider only when you request an explanation.</p><div className="privacy-note key-note"><strong>Bring your own key</strong><p>Your API key is relayed to the selected provider in real time and is not persisted on PrepDeck servers. If you choose local encrypted storage, the key is encrypted in your browser using your passphrase. Shared explanation results may be cached for other members of your group.</p></div></section>
            <section id="storage"><span className="section-number">06</span><h2>Storage &amp; security</h2><p>PrepDeck uses access controls, encrypted connections, and role-based permissions designed to protect information. No system is completely secure, so we cannot guarantee absolute security. Keep your device, Google account, passphrase, and provider keys safe.</p></section>
            <section id="choices"><span className="section-number">07</span><h2>Your choices</h2><p>You can edit or remove notes, bookmarks, annotations, locally stored keys, and certain preferences through the app. You may ask your PrepDeck administrator about access to, correction of, or deletion of account data. Some records may need to be retained for security, integrity, or legal reasons.</p></section>
            <section id="retention"><span className="section-number">08</span><h2>Retention</h2><p>We keep information for as long as your account is active or as needed to provide the service. Retention may continue where reasonably necessary for security, backups, dispute resolution, or legal compliance. Locally stored settings remain on your device until you clear them.</p></section>
            <section id="children"><span className="section-number">09</span><h2>Children’s privacy</h2><p>PrepDeck is not directed to children under 13, and we do not knowingly collect personal information from them. If you believe a child has provided information, contact your PrepDeck administrator.</p></section>
            <section id="changes"><span className="section-number">10</span><h2>Changes to this policy</h2><p>We may update this policy as PrepDeck evolves. We will revise the “Last updated” date and provide additional notice when a change is material.</p></section>
            <section id="contact"><span className="section-number">11</span><h2>Questions? Let’s talk.</h2><p>For privacy questions or requests, contact the administrator who invited you to your PrepDeck workspace. They can help with your account or route your request to the service operator.</p><a className="privacy-contact" href="/">Return to PrepDeck <span>→</span></a></section>
          </article>
        </div>
      </main>

      <footer className="privacy-footer"><BrandLogo /><p>Study with confidence. Built with care.</p><p>© 2026 PrepDeck</p></footer>
    </div>
  );
}
