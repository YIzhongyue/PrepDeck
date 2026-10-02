# 2D mascot cutout prompts

The eight project cutouts were edited with the built-in `image_gen` tool on
2026-10-01, using the corresponding existing white-background PNG as each edit
target. They are saved under `apps/web/public/mascot/2D-Anime/transparent/`.
Originals and the earlier unused `normal-transparent.png` remain unchanged.
Each output is a 1254 × 1254 RGBA PNG. No CLI/API fallback was used.

Final accepted prompt set follows. Intermediate outputs containing a painted
checkerboard instead of alpha were rejected and are not shipped.

## normal.png

Use case: background-extraction. Edit target: the supplied existing PrepDeck 2D mascot PNG. Remove ONLY the off-white/white background and output a genuinely transparent RGBA PNG with an alpha channel. This is precision background removal, not redrawing or restyling. Preserve the exact character, face, line art, colors, pose, clothes, books, tail, detached blue star and accent marks, composition and framing from the source. Keep all white fabric, white stockings, white page edges, pale skin and highlights opaque. Remove background also in enclosed gaps between hair strands, limbs, clothes and tail. Clean antialiased edges, no white fringe, no shadow, no new background, no checkerboard baked into the pixels. Keep the original square canvas and full subject; do not crop any hair, ears, feet or props.

## unauthorized.png, not-found.png, no-internet.png

Use case: background-extraction. Edit target: the supplied existing PrepDeck mascot. Remove ONLY the white/off-white background, including enclosed background gaps. Output a truly transparent RGBA PNG with alpha, no baked checkerboard. Preserve the original 2D illustration exactly: same face, pose, proportions, expression, hair, tail, colors, shading, outlines, ALL props and detached symbols. White clothing, white stockings, pale skin, highlights, paper, light-colored props remain fully opaque. Do not redraw, restyle, simplify or add anything. Preserve square canvas and subject position and size; nothing cropped. Clean antialiased contours, no white halo or fringe. Remove ground/background shadows; keep subject shading.

## maintenance.png, finish-exam.png

Use case: background-extraction. Edit target: the supplied existing PrepDeck mascot. Remove ONLY the white/off-white background, including enclosed background gaps. Output a truly transparent RGBA PNG with alpha, no baked checkerboard. Preserve the original 2D illustration exactly: same face, pose, proportions, expression, hair, tail, colors, shading, outlines, ALL props and detached symbols. White clothing, white stockings, pale skin, highlights, paper, light-colored props remain fully opaque. Do not redraw, restyle, simplify or add anything. Preserve square canvas and subject position and size; nothing cropped. Clean antialiased contours, no white halo or fringe. Remove ground/background shadows; keep subject shading. Ensure the alpha mask has no isolated stray pixels, no white remnants in gaps, and no loss of the thin character outline.

## contents-break.png

Extract this exact existing illustration from its white background. Deliver a transparent PNG cutout with a REAL alpha channel: all background pixels must have alpha=0. Preserve the character, its white outfit and stockings, its pose, all props and every colored floating symbol. Keep square framing and the same character scale. Change only background transparency; retain the original illustration. This is a website asset that will be composited over dark and colored surfaces.

## finish-practice.png

给这张原图抠图，只去掉白色背景，导出带真实 alpha 透明通道的 PNG，背景区域 alpha 为 0。不要画棋盘格，不要画任何背景。保留原人物、白衣服、白袜子、手上的清单、蓝色和黄色星星及感叹装饰，保留所有原构图和姿势。尤其不要误删衣服和清单上的白色。直接输出可用于网页的透明背景人物素材。

