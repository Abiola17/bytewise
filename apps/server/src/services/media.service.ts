import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  MAX_SCREENSHOT_BYTES,
  MAX_TRANSCRIPTION_SECONDS,
  screenshotSchema,
  type CreateScreenshotRequest,
  type Screenshot,
  type TranscriptionResponse,
} from "@bytewise/shared";
import type { Db } from "../database/client";
import { evidence, screenshots, type ScreenshotRow } from "../database/schema";
import { AppError, badRequest, notFound } from "../errors/app-error";
import { readImageInfo } from "../filesystem/image-info";
import {
  PCM_BYTES_PER_SECOND,
  type TranscriptionProvider,
} from "../providers/meta/meta.transcription";
import type { LiveHandlers, LiveTranscription } from "../providers/meta/meta.live-transcription";

/** Live dictation stops by itself after this much audio. */
export const MAX_LIVE_AUDIO_BYTES = MAX_TRANSCRIPTION_SECONDS * PCM_BYTES_PER_SECOND;
import type { SegmentationProvider } from "../providers/meta/meta.segmentation";
import type { SessionService } from "./session.service";

const MIN_AUDIO_BYTES = PCM_BYTES_PER_SECOND / 4; // 250 ms
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export function toScreenshotDto(row: ScreenshotRow): Screenshot {
  return screenshotSchema.parse({ ...row, regions: JSON.parse(row.regionsJson) });
}

/** Text form of a screenshot's regions, used as observed evidence for the diagnosis model. */
export function describeRegions(shot: Screenshot): string {
  const header = `Screenshot ${shot.width}×${shot.height} px${shot.fileName ? ` (${shot.fileName})` : ""}. SAM 3.1 found ${shot.regions.length} region(s) matching "${shot.phrase}".`;
  const lines = shot.regions.map(
    (r, i) =>
      `${i + 1}. x1=${r.x1} y1=${r.y1} x2=${r.x2} y2=${r.y2} (${r.x2 - r.x1}×${r.y2 - r.y1} px)`,
  );
  return [header, ...lines].join("\n");
}

export function createMediaService(deps: {
  db: Db;
  sessionService: SessionService;
  transcription: TranscriptionProvider;
  segmentation: SegmentationProvider;
  screenshotsDir: string;
}) {
  const { db, sessionService, transcription, segmentation, screenshotsDir } = deps;

  const imagePath = (row: Pick<ScreenshotRow, "id" | "mimeType">) =>
    path.join(screenshotsDir, `${row.id}.${EXTENSIONS[row.mimeType as keyof typeof EXTENSIONS]}`);

  return {
    /** Transcribes uploaded PCM16 24 kHz mono audio. Nothing is stored. */
    async transcribe(pcm: Buffer): Promise<TranscriptionResponse> {
      if (pcm.length < MIN_AUDIO_BYTES) throw badRequest("The recording is too short.");
      if (pcm.length % 2 !== 0) throw badRequest("Audio must be 16-bit PCM.");
      if (pcm.length > MAX_TRANSCRIPTION_SECONDS * PCM_BYTES_PER_SECOND) {
        throw badRequest(`Recordings are limited to ${MAX_TRANSCRIPTION_SECONDS} seconds.`);
      }
      return transcription.transcribe(pcm);
    },

    /** Starts live dictation; the caller streams audio in and gets text back as it is recognized. */
    liveTranscription(handlers: LiveHandlers): LiveTranscription {
      return transcription.live(handlers);
    },

    /**
     * Stores a screenshot, asks SAM 3.1 for regions matching the phrase, and
     * records the result as observed evidence in the session.
     */
    async createScreenshot(sessionId: string, input: CreateScreenshotRequest): Promise<Screenshot> {
      sessionService.getRow(sessionId);
      const image = Buffer.from(input.data, "base64");
      if (image.length === 0) throw badRequest("The image is empty.");
      if (image.length > MAX_SCREENSHOT_BYTES) {
        throw new AppError(413, "file_too_large", "Screenshots are limited to 4 MB.");
      }
      const info = readImageInfo(image);
      if (!info) throw new AppError(415, "unsupported_image", "Upload a PNG, JPEG or WebP image.");
      if (info.mimeType !== input.mimeType) {
        throw badRequest(`The file is a ${info.mimeType} image, not ${input.mimeType}.`);
      }

      const { regions, model } = await segmentation.segment(image, info.mimeType, input.phrase);
      const row: ScreenshotRow = {
        id: randomUUID(),
        sessionId,
        phrase: input.phrase,
        fileName: input.fileName?.replace(/[^\w.\- ]/g, "_") || null,
        mimeType: info.mimeType,
        width: info.width,
        height: info.height,
        regionsJson: JSON.stringify(regions),
        model,
        createdAt: new Date().toISOString(),
      };

      fs.mkdirSync(screenshotsDir, { recursive: true });
      fs.writeFileSync(imagePath(row), image, { flag: "wx" });
      const shot = toScreenshotDto(row);
      const excerpt = describeRegions(shot);

      db.transaction((tx) => {
        tx.insert(screenshots).values(row).run();
        tx.insert(evidence)
          .values({
            id: `ev_${createHash("sha1").update(`shot:${row.id}\n${excerpt}`).digest("hex").slice(0, 12)}`,
            sessionId,
            sourceType: "screenshot_regions",
            relativePath: `screenshot: ${row.fileName ?? row.id.slice(0, 8)}`,
            startLine: 1,
            endLine: Math.max(1, regions.length + 1),
            excerpt,
            description: `Regions detected by SAM 3.1 in a screenshot the developer provided (phrase: "${input.phrase}").`,
            createdAt: row.createdAt,
          })
          .run();
      });
      return shot;
    },

    /** Absolute path and type of a stored screenshot image. */
    image(screenshotId: string): { file: string; mimeType: string } {
      const row = db.select().from(screenshots).where(eq(screenshots.id, screenshotId)).get();
      if (!row) throw notFound("Screenshot");
      const file = imagePath(row);
      if (!fs.existsSync(file)) throw notFound("Screenshot image");
      return { file, mimeType: row.mimeType };
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;
