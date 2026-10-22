import { useState } from "react";
import type { UserProfile } from "@prepdeck/shared";
import { useI18n } from "../i18n";

export function profileInitials(profile: UserProfile | null): string {
  const source = profile?.displayName?.trim() || profile?.email?.split("@")[0] || "?";
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function ProfileAvatar({ profile, size = 30 }: { profile: UserProfile | null; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!profile?.avatarUrl && failedUrl !== profile.avatarUrl;
  const sharedStyle = { width: size, height: size, flex: "none", borderRadius: "50%" } as const;
  const { t } = useI18n();

  if (showImage) {
    return (
      <img
        src={profile.avatarUrl!}
        alt={t("profile.avatarOf", { name: profile.displayName || profile.email })}
        onError={() => setFailedUrl(profile.avatarUrl)}
        style={{ ...sharedStyle, objectFit: "cover", background: "var(--color-accent-2-200)" }}
      />
    );
  }

  return (
    <span
      aria-label={profile ? t("profile.avatarOf", { name: profile.displayName || profile.email }) : t("profile.loading")}
      style={{
        ...sharedStyle, display: "grid", placeItems: "center", background: "var(--color-accent-2-300)",
        color: "var(--color-accent-2-900)", fontSize: Math.max(11, Math.round(size * 0.34)), fontWeight: 700
      }}
    >
      {profileInitials(profile)}
    </span>
  );
}
