export const MASCOT_STYLES = ["3D-Chibi", "2D-Anime"] as const;
export type MascotStyle = typeof MASCOT_STYLES[number];
export const DEFAULT_MASCOT_STYLE: MascotStyle = "3D-Chibi";
export const MASCOT_SCENES = [
  "normal", "unauthorized", "not-found", "no-internet", "maintenance",
  "contents-break", "finish-practice", "finish-exam",
] as const;
export type MascotScene = typeof MASCOT_SCENES[number];
export interface SiteAppearance { mascotStyle: MascotStyle }

export function isMascotStyle(value: unknown): value is MascotStyle {
  return value === "3D-Chibi" || value === "2D-Anime";
}

export function mascotImagePath(style: MascotStyle, scene: MascotScene): string {
  return `/mascot/${style}/${scene}.png`;
}
