"""Read white-on-dark Japanese 問N labels before OCR of the surrounding text.

Every label is read from pixels, never inferred from page/order. Original page
renders remain in the extraction evidence. This is an OCR aid, not approval.
"""
import re
from pathlib import Path


def recognize(image: Path, language: str, dpi: int, psm: int, command) -> str:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError("Boxed-header OCR requires opencv-python-headless (pip install opencv-python-headless); use --no-boxed-headers for ordinary OCR") from error
    gray = cv2.imread(str(image), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise RuntimeError("Cannot decode OCR page image")
    height, width = gray.shape
    _, _, components, _ = cv2.connectedComponentsWithStats((gray < 170).astype("uint8"), 8)
    boxes = []
    for x, y, w, h, area in components[1:]:
        # Subject B uses full-width bars: read only the left label area,
        # retaining the rest of the bar (including any answer) in body OCR.
        if (x < width * .45 and w > dpi * .15 and dpi * .04 < h < dpi * .55
                and 1.1 < w / h and area / (w * h) > .60):
            label_width = min(int(w), round(h * 3)) if w / h >= 4 else int(w)
            boxes.append((int(x), int(y), label_width, int(h)))
    headers = []
    # A pathological diagram must not trigger thousands of OCR subprocesses.
    if len(boxes) > 64:
        boxes = []
    for x, y, w, h in boxes:
        inset = max(1, round(dpi / 100))
        crop = 255 - gray[y + inset:y + h - inset, x + inset:x + w - inset]
        # Gray explanation labels are lighter than red question labels; one
        # fixed cutoff would erase their white characters after inversion.
        readings = set()
        for cutoff, mode in [(0, cv2.THRESH_BINARY | cv2.THRESH_OTSU), (160, cv2.THRESH_BINARY)]:
            normalized = cv2.threshold(crop, cutoff, 255, mode)[1]
            normalized = cv2.copyMakeBorder(normalized, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
            target = image.with_name(f"label-{y}-{x}-{cutoff}.png")
            cv2.imwrite(str(target), normalized)
            text = command(["tesseract", str(target), "stdout", "-l", "jpn", "--psm", "7"]).stdout.strip()
            match = re.fullmatch(r"(問|設問)\s*([0-9０-９]{1,3})?", text)
            if match:
                if match.group(1) == "設問" or match.group(2):
                    readings.add(match.group(1) + (str(int(match.group(2))) if match.group(2) else ""))
        if len(readings) == 1:
            headers.append((x, y, w, h, readings.pop()))
    if not headers:
        return command(["tesseract", str(image), "stdout", "-l", language, "--psm", str(psm)]).stdout
    headers.sort(key=lambda h: (h[1], h[0]))
    # Ambiguous columns / overlapping headers cannot safely define full-width bands.
    if any(a[1] + a[3] > b[1] for a, b in zip(headers, headers[1:])):
        return command(["tesseract", str(image), "stdout", "-l", language, "--psm", str(psm)]).stdout
    output = []
    boundaries = [0, *(h[1] for h in headers), height]
    for i, (top, bottom) in enumerate(zip(boundaries, boundaries[1:])):
        if top == bottom:
            continue
        band = gray[top:bottom].copy()
        label = ""
        if i:
            x, _, w, h, label = headers[i - 1]
            band[:h, x:x + w] = 255
        target = image.with_name(f"band-{i}.png")
        cv2.imwrite(str(target), band)
        body = command(["tesseract", str(target), "stdout", "-l", language, "--psm", str(psm)]).stdout.strip()
        output.append((label + " " + body).strip())
    return "\n\n".join(output)
