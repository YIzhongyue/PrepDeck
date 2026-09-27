import { NAV, NAV_GROUPS } from "../data/constants";
import type { ScreenId } from "../types";

/**
 * "Study › Learning" above a page title: the screen's sidebar section, then
 * the screen itself, both named and drawn as the sidebar does. The section is
 * a heading in the sidebar rather than a page, so it is not a link. `meta` is
 * a short note that applies to the whole page, set as a pill after the trail.
 * Styles live in app.css (`.pd-crumbs`).
 */
export default function PageBreadcrumb({ screen, meta }: { screen: ScreenId; meta?: string }) {
  const item = NAV.find((n) => n.id === screen);
  const section = NAV_GROUPS.find((g) => g.ids.includes(screen));
  if (!item || !section) return null;
  return (
    <nav aria-label="Breadcrumb" className="pd-crumbs">
      <ol>
        <li className="pd-crumbs-section">
          <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={item.d} />
            </svg>
            {section.label}
          </span>
          <svg className="pd-crumbs-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </li>
        <li><span aria-current="page">{item.label}</span></li>
      </ol>
      {meta && <span className="pd-crumbs-meta">{meta}</span>}
    </nav>
  );
}
