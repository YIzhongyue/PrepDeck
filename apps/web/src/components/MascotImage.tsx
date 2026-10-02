import { useState, type ImgHTMLAttributes } from "react";
import { DEFAULT_MASCOT_STYLE, mascotImagePath, type MascotScene, type MascotStyle } from "@prepdeck/shared";
import { useMascot } from "../store/MascotContext";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  scene?: MascotScene;
  mascotStyle?: MascotStyle;
};

export default function MascotImage({ scene = "normal", mascotStyle, ...props }: Props) {
  const { style } = useMascot();
  const selected = mascotStyle ?? style;
  return <ResolvedImage key={`${selected}/${scene}`} selected={selected} scene={scene} {...props} />;
}

function ResolvedImage({ selected, scene, style, ...props }: Omit<Props, "mascotStyle"> & { selected: MascotStyle; scene: MascotScene }) {
  const [failures, setFailures] = useState(0);
  const exhausted = failures >= (selected === DEFAULT_MASCOT_STYLE ? 1 : 2);
  const source = mascotImagePath(failures ? DEFAULT_MASCOT_STYLE : selected, scene);
  // Preserve the occupied space, without leaving a broken-image icon or
  // changing an error/success scene into a misleading normal pose.
  if (exhausted) return <span className={props.className} aria-hidden="true" style={{ display: "block", aspectRatio: "1", ...style, visibility: "hidden" }} />;
  return <img {...props} src={source} style={{ objectFit: "contain", aspectRatio: "1", borderRadius: 24, ...style }} onError={() => setFailures(n => n + 1)} />;
}
