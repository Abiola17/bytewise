import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { MAX_SCREENSHOT_BYTES, type MessageImage, type PostMessageRequest } from "@bytewise/shared";
import type { MessageImageRow } from "../database/schema";
import { AppError, badRequest, notFound } from "../errors/app-error";
import { readImageInfo, type ImageInfo } from "../filesystem/image-info";
import type { SessionsRepository } from "../repositories/sessions.repository";

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export interface ValidatedImage {
  fileName: string | null;
  bytes: Buffer;
  info: ImageInfo;
}

export function toMessageImageDto(row: MessageImageRow): MessageImage {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType as MessageImage["mimeType"],
    width: row.width,
    height: row.height,
  };
}

/**
 * Images attached to chat messages. Each upload is checked by its own bytes,
 * stored under the screenshots directory and shown to the model with its request.
 */
export function createMessageImagesService(deps: { sessions: SessionsRepository; dir: string }) {
  const { sessions, dir } = deps;
  const filePath = (row: Pick<MessageImageRow, "id" | "mimeType">) =>
    path.join(dir, `msg_${row.id}.${EXTENSIONS[row.mimeType as keyof typeof EXTENSIONS]}`);

  return {
    validate(images: PostMessageRequest["images"]): ValidatedImage[] {
      return images.map((image, i) => {
        const label = image.fileName || `Image ${i + 1}`;
        const bytes = Buffer.from(image.data, "base64");
        if (bytes.length === 0) throw badRequest(`${label} is empty.`);
        if (bytes.length > MAX_SCREENSHOT_BYTES) {
          throw new AppError(413, "file_too_large", `${label} is larger than 4 MB.`);
        }
        const info = readImageInfo(bytes);
        if (!info) {
          throw new AppError(
            415,
            "unsupported_image",
            `${label} is not a PNG, JPEG or WebP image.`,
          );
        }
        return {
          fileName: image.fileName?.slice(0, 100).replace(/[^\w.\- ]/g, "_") || null,
          bytes,
          info,
        };
      });
    },

    /** Writes the files and returns the rows to insert with the message. */
    write(messageId: string, sessionId: string, images: ValidatedImage[]): MessageImageRow[] {
      if (images.length === 0) return [];
      fs.mkdirSync(dir, { recursive: true });
      const createdAt = new Date().toISOString();
      return images.map((image) => {
        const row: MessageImageRow = {
          id: randomUUID(),
          messageId,
          sessionId,
          fileName: image.fileName,
          mimeType: image.info.mimeType,
          width: image.info.width,
          height: image.info.height,
          sha256: createHash("sha256").update(image.bytes).digest("hex"),
          createdAt,
        };
        fs.writeFileSync(filePath(row), image.bytes, { flag: "wx" });
        return row;
      });
    },

    /** Removes files written for a message that could not be stored. */
    discard(rows: MessageImageRow[]) {
      for (const row of rows) fs.rmSync(filePath(row), { force: true });
    },

    /** Image bytes as a data URL for the model; null if the file is missing or changed. */
    dataUrl(row: MessageImageRow): string | null {
      const file = filePath(row);
      if (!fs.existsSync(file)) return null;
      const bytes = fs.readFileSync(file);
      if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) return null;
      return `data:${row.mimeType};base64,${bytes.toString("base64")}`;
    },

    file(imageId: string): { file: string; mimeType: string } {
      const row = sessions.messageImage(imageId);
      if (!row) throw notFound("Image");
      const file = filePath(row);
      if (!fs.existsSync(file)) throw notFound("Image file");
      return { file, mimeType: row.mimeType };
    },
  };
}

export type MessageImagesService = ReturnType<typeof createMessageImagesService>;
