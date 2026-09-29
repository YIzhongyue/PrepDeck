import { useId } from "react";
import ModalLayer from "./ModalLayer";

export function AdminIcon({ name }: { name: "overview" | "users" | "exams" | "shield" | "arrow" | "back" | "plus" | "search" | "key" }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    exams: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    back: <><path d="M19 12H5M11 18l-6-6 6-6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    key: <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>
  };
  return <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function AdminModal({
  icon, title, subtitle, onClose, closeDisabled = false, children
}: {
  icon: "users" | "exams" | "shield";
  title: string;
  subtitle: string;
  onClose: () => void;
  // Keeps the ✕ inert while a save is in flight; Escape is gated by onClose.
  closeDisabled?: boolean;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <ModalLayer labelledBy={titleId} onClose={onClose}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <span className="admin-modal-icon"><AdminIcon name={icon} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id={titleId}>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="admin-modal-close" aria-label="Close" disabled={closeDisabled} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </ModalLayer>
  );
}
