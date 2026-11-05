/**
 * Images the developer attaches to a message. They are validated by their own
 * bytes (never the declared type) before being sent to the model.
 */

export const IMAGE_LIMITS = {
  maxImages: 4,
  maxBytes: 4 * 1024 * 1024,
};

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface ImageAttachment {
  name: string;
  mimeType: ImageMime;
  /** Base64 without a data: prefix. */
  dataBase64: string;
}

/** The real type of an image, from its first bytes. */
export function sniffImageType(bytes: Uint8Array): ImageMime | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type ImageCheck = { ok: true; images: ImageAttachment[] } | { ok: false; error: string };

/** Validates raw attachments from the panel. */
export function validateImages(raw: Array<{ name?: unknown; dataBase64?: unknown }>): ImageCheck {
  if (raw.length > IMAGE_LIMITS.maxImages) {
    return { ok: false, error: `Attach at most ${IMAGE_LIMITS.maxImages} images per message.` };
  }
  const images: ImageAttachment[] = [];
  for (const item of raw) {
    const name =
      typeof item.name === "string" ? item.name.replace(/[^\w.\- ]/g, "_").slice(0, 80) : "image";
    if (typeof item.dataBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.dataBase64)) {
      return { ok: false, error: `${name} could not be read.` };
    }
    const bytes = Uint8Array.from(Buffer.from(item.dataBase64, "base64"));
    if (bytes.length === 0) return { ok: false, error: `${name} is empty.` };
    if (bytes.length > IMAGE_LIMITS.maxBytes) {
      return { ok: false, error: `${name} is larger than 4 MB.` };
    }
    const mimeType = sniffImageType(bytes);
    if (!mimeType) return { ok: false, error: `${name} is not a PNG, JPEG, WebP or GIF image.` };
    images.push({ name, mimeType, dataBase64: item.dataBase64 });
  }
  return { ok: true, images };
}

export const dataUrl = (image: ImageAttachment) =>
  `data:${image.mimeType};base64,${image.dataBase64}`;
