"""Read configured white-on-dark labels before OCR of the surrounding text.

Every label is read from pixels, never inferred from page/order. Original page
renders remain in the extraction evidence. This is an OCR aid, not approval.
"""

import re
from pathlib import Path


def recognize(
    image: Path,
    language: str,
    dpi: int,
    psm: int,
    command,
    label_pattern=r"(Q(?:uestion)?|Part)\s*([0-9]{1,3})?",
) -> str:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError(
            "Boxed-header OCR requires opencv-python-headless (pip install opencv-python-headless); use --no-boxed-headers for ordinary OCR"
        ) from error
    gray = cv2.imread(str(image), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise RuntimeError("Cannot decode OCR page image")
    height, width = gray.shape
    _, _, components, _ = cv2.connectedComponentsWithStats(
        (gray < 170).astype("uint8"), 8
    )
    boxes = []
    for x, y, w, h, area in components[1:]:
        # Wide heading bars: read only the left label area,
        # retaining the rest of the bar (including any answer) in body OCR.
        if (
            x < width * 0.45
            and w > dpi * 0.15
            and dpi * 0.04 < h < dpi * 0.55
            and 1.1 < w / h
            and area / (w * h) > 0.60
        ):
            label_width = min(int(w), round(h * 3)) if w / h >= 4 else int(w)
            boxes.append((int(x), int(y), label_width, int(h), int(w)))
    headers = []
    # A pathological diagram must not trigger thousands of OCR subprocesses.
    if len(boxes) > 64:
        boxes = []
    for x, y, w, h, bar_width in boxes:
        inset = max(1, round(dpi / 100))
        crop = 255 - gray[y + inset : y + h - inset, x + inset : x + w - inset]
        # Gray explanation labels are lighter than red question labels; one
        # fixed cutoff would erase their white characters after inversion.
        readings = set()
        for cutoff, mode in [
            (0, cv2.THRESH_BINARY | cv2.THRESH_OTSU),
            (160, cv2.THRESH_BINARY),
        ]:
            normalized = cv2.threshold(crop, cutoff, 255, mode)[1]
            normalized = cv2.copyMakeBorder(
                normalized, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255
            )
            target = image.with_name(f"label-{y}-{x}-{cutoff}.png")
            cv2.imwrite(str(target), normalized)
            text = command(
                ["tesseract", str(target), "stdout", "-l", language, "--psm", "7"]
            ).stdout.strip()
            match = re.fullmatch(label_pattern, text)
            if match:
                readings.add(
                    "".join(match.group(0).split()).translate(
                        str.maketrans("０１２３４５６７８９", "0123456789")
                    )
                )
        if len(readings) == 1:
            headers.append((x, y, w, h, readings.pop(), bar_width))
    if not headers:
        return command(
            ["tesseract", str(image), "stdout", "-l", language, "--psm", str(psm)]
        ).stdout
    headers.sort(key=lambda h: (h[1], h[0]))
    # Ambiguous columns / overlapping headers cannot safely define full-width bands.
    if any(a[1] + a[3] > b[1] for a, b in zip(headers, headers[1:])):
        return command(
            ["tesseract", str(image), "stdout", "-l", language, "--psm", str(psm)]
        ).stdout
    output = []
    boundaries = [0, *(h[1] for h in headers), height]
    for i, (top, bottom) in enumerate(zip(boundaries, boundaries[1:])):
        if top == bottom:
            continue
        band = gray[top:bottom].copy()
        label = ""
        if i:
            x, _, w, h, label, bar_width = headers[i - 1]
            # White answer glyphs elsewhere in a dark heading bar need the
            # same inversion as the number. Keep them in body reading order.
            if bar_width > w:
                remainder = 255 - band[:h, x + w : x + bar_width]
                band[:h, x + w : x + bar_width] = cv2.threshold(
                    remainder, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU
                )[1]
            band[:h, x : x + w] = 255
        target = image.with_name(f"band-{i}.png")
        cv2.imwrite(str(target), band)
        body = command(
            ["tesseract", str(target), "stdout", "-l", language, "--psm", str(psm)]
        ).stdout.strip()
        output.append((label + " " + body).strip())
    return "\n\n".join(output)
