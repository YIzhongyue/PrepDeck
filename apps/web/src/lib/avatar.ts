// FR-12.4: restrict avatar uploads to JPEG/PNG/WebP and a reasonable max
// size, resizing/compressing client-side where practical before upload. The
// server re-validates type and the 2 MB cap regardless (see routes/profile.ts).

const MAX_DIMENSION = 512;
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class AvatarValidationError extends Error {}

export async function prepareAvatarUpload(file: File): Promise<Blob> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new AvatarValidationError("Please choose a JPEG, PNG, or WebP image.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarValidationError("Could not read this image file.");
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarValidationError("Could not process this image.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  // PNG stays PNG (avatars with transparency are common); anything else
  // compresses to JPEG regardless of the source format.
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.85));
  if (!blob) throw new AvatarValidationError("Could not process this image.");
  if (blob.size > MAX_BYTES) {
    throw new AvatarValidationError("This image is too large even after compression — please choose a smaller file.");
  }
  return blob;
}
