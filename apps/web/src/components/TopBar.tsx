import { NAV } from "../data/constants";
import { usePrepDeck } from "../store/PrepDeckContext";
import BrandLogo from "./BrandLogo";
import ExamSelector from "./ExamSelector";
import ProfileAvatar from "./ProfileAvatar";

export default function TopBar() {
  const { state } = usePrepDeck();
  const title = NAV.find((n) => n.id === state.screen)?.label || "PrepDeck";
  return (
    <header
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
        borderBottom: "1px solid var(--color-divider)", position: "sticky", top: 0, zIndex: 30,
        background: "var(--color-bg)"
      }}
    >
      <BrandLogo compact />
      <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, marginRight: "auto" }}>{title}</span>
      <ExamSelector compact />
      <ProfileAvatar profile={state.me} size={28} />
    </header>
  );
}
