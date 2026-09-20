export const ICON_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type IconContentType = (typeof ICON_CONTENT_TYPES)[number];

const MAX_IMAGE_PIXELS = 16_777_216;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const hasBytes = (bytes: Uint8Array, offset: number, expected: readonly number[]) =>
  expected.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const dimensionsAreSafe = (width: number, height: number) =>
  width > 0 && height > 0 && width <= MAX_IMAGE_PIXELS / height;

function isPng(bytes: Uint8Array, view: DataView): boolean {
  if (bytes.length < 45 || !hasBytes(bytes, 0, PNG_SIGNATURE)) return false;
  let offset = 8;
  let sawHeader = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return false;
      sawHeader = dimensionsAreSafe(view.getUint32(offset + 8), view.getUint32(offset + 12));
      if (!sawHeader) return false;
    }
    if (type === "IEND") return length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function isJpeg(bytes: Uint8Array, view: DataView): boolean {
  if (bytes.length < 4 || !hasBytes(bytes, 0, [0xff, 0xd8])) return false;
  let offset = 2;
  let safeDimensions = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) return safeDimensions && offset === bytes.length;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return false;
      const scanLength = view.getUint16(offset);
      if (scanLength < 2 || offset + scanLength > bytes.length) return false;
      offset += scanLength;
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
      continue;
    }
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return false;
      safeDimensions = dimensionsAreSafe(view.getUint16(offset + 5), view.getUint16(offset + 3));
      if (!safeDimensions) return false;
    }
    offset += length;
  }
  return false;
}

function isWebp(bytes: Uint8Array, view: DataView): boolean {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
  if (view.getUint32(4, true) + 8 !== bytes.length) return false;
  const chunk = ascii(bytes, 12, 4);
  const chunkLength = view.getUint32(16, true);
  if (20 + chunkLength + (chunkLength & 1) > bytes.length) return false;
  if (chunk === "VP8X" && chunkLength >= 10) {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return dimensionsAreSafe(width, height);
  }
  if (chunk === "VP8 " && chunkLength >= 10 && hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return dimensionsAreSafe(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (chunk === "VP8L" && chunkLength >= 5 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return dimensionsAreSafe((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return false;
}

export function hasValidImageContent(body: ArrayBuffer, contentType: IconContentType): boolean {
  const bytes = new Uint8Array(body);
  const view = new DataView(body);
  if (contentType === "image/png") return isPng(bytes, view);
  if (contentType === "image/jpeg") return isJpeg(bytes, view);
  return isWebp(bytes, view);
}
