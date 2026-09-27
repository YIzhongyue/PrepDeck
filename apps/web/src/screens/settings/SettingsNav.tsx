import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { isModifiedClick } from "../../store/urlRouting";

// The Settings screen is one long page in three groups. Wide screens index it
// with a sticky list beside the content; narrow ones with a sticky row of chips
// under the top bar. Both follow the scroll position and jump on click.

export type SectionId = "profile" | "session" | "appearance" | "marks" | "notes" | "timezone" | "email" | "ai" | "mcp";

// A short status shown beside a section's name, such as whether the daily
// email is on.
export interface SectionMeta {
  text: string;
  dot: string;
}

const GROUPS: { label: string; items: { id: SectionId; label: string }[] }[] = [
  { label: "Account", items: [{ id: "profile", label: "Profile" }, { id: "session", label: "Sign out" }] },
  {
    label: "Study",
    items: [
      { id: "appearance", label: "Appearance" }, { id: "marks", label: "Mark aliases" }, { id: "notes", label: "Shared notes" },
      { id: "timezone", label: "Time zone" }, { id: "email", label: "Daily email" }
    ]
  },
  { label: "AI & integrations", items: [{ id: "ai", label: "AI explanations" }, { id: "mcp", label: "MCP access" }] }
];

const SECTION_IDS = GROUPS.flatMap((g) => g.items.map((item) => item.id));

export const sectionDomId = (id: SectionId) => `settings-${id}`;

// Props for the element a section's index entry scrolls to. It takes focus
// on a jump, as following an in-page link would give it.
export const sectionAnchor = (id: SectionId) => ({ id: sectionDomId(id), tabIndex: -1, "data-settings-section": "" });

// How far below the sticky bars a section's top may sit and still count as
// the one being read.
const READING_LINE = 96;

export function useSectionNavigation(chipBarRef: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<SectionId>("profile");
  // The section the reader jumped to stays current until they scroll by hand.
  // Short sections near the end of the page never reach the reading line, so
  // measuring alone would light up a later one.
  const pinned = useRef<SectionId | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (pinned.current) return;
      const line = (chipBarRef.current?.getBoundingClientRect().bottom ?? 0) + READING_LINE;
      let current: SectionId = "profile";
      for (const id of SECTION_IDS) {
        const el = document.getElementById(sectionDomId(id));
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      const doc = document.documentElement;
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) current = SECTION_IDS[SECTION_IDS.length - 1]!;
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const release = () => { pinned.current = null; };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Only a reader's own input releases the pin; the smooth scroll a jump
    // starts fires scroll events but none of these.
    const intents = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const type of intents) window.addEventListener(type, release, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const type of intents) window.removeEventListener(type, release, { capture: true });
    };
  }, [chipBarRef]);

  const jump = useCallback((id: SectionId) => {
    const el = document.getElementById(sectionDomId(id));
    if (!el) return;
    setActive(id);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    el.focus({ preventScroll: true });
    // Set after the click's own pointer/key events have released the old pin.
    pinned.current = id;
  }, []);

  return { active, jump };
}

interface NavProps {
  active: SectionId;
  meta: Partial<Record<SectionId, SectionMeta>>;
  onJump: (id: SectionId) => void;
}

// A chip has room for the status dot only; its text stays for screen readers.
function SectionLink({ id, label, active, meta, onJump, chip = false }: NavProps & { id: SectionId; label: string; chip?: boolean }) {
  const m = meta[id];
  const dot = m && <span className="settings-dot" style={{ background: m.dot }} aria-hidden="true" />;
  return (
    <a
      href={`#${sectionDomId(id)}`}
      className={chip ? "settings-chip" : "settings-toc-link"}
      data-section={id}
      aria-current={active === id ? "location" : undefined}
      onClick={(event) => {
        if (isModifiedClick(event)) return;
        event.preventDefault();
        onJump(id);
      }}
    >
      {chip ? (
        <>{dot}{label}{m && <span className="sr-only">, {m.text}</span>}</>
      ) : (
        <>
          <span className="settings-nav-label">{label}</span>
          {m && <span className="settings-nav-meta">{dot}{m.text}</span>}
        </>
      )}
    </a>
  );
}

export function SettingsToc(props: NavProps) {
  return (
    <nav aria-label="Settings sections" className="settings-toc">
      {GROUPS.map((group) => (
        <div key={group.label} className="settings-toc-group">
          <p className="settings-toc-heading">{group.label}</p>
          {group.items.map((item) => (
            <SectionLink key={item.id} {...props} id={item.id} label={item.label} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function SettingsChips({ barRef, inset, ...props }: NavProps & { barRef: RefObject<HTMLElement | null>; inset: { top: number; inline: number } }) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Keep the current chip in view as the page scrolls past its section.
  useEffect(() => {
    const track = trackRef.current;
    const chip = track?.querySelector<HTMLElement>(`[data-section="${props.active}"]`);
    if (!track || !chip) return;
    const left = chip.offsetLeft - (track.clientWidth - chip.offsetWidth) / 2;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }, [props.active]);

  return (
    // Pulled out of the shell's padding so the bar runs edge to edge.
    <nav
      ref={barRef}
      aria-label="Settings sections"
      className="settings-chips"
      style={{ marginTop: -inset.top, marginInline: -inset.inline }}
    >
      <div ref={trackRef} className="settings-chips-track" style={{ paddingInline: inset.inline }}>
        {GROUPS.flatMap((group) => group.items).map((item) => (
          <SectionLink key={item.id} {...props} id={item.id} label={item.label} chip />
        ))}
      </div>
    </nav>
  );
}
