import { z } from "zod";

/** Voice input: raw PCM16 little-endian, 24 kHz, mono, uploaded as application/octet-stream. */
export const TRANSCRIPTION_SAMPLE_RATE = 24_000;
export const MAX_TRANSCRIPTION_SECONDS = 60;

export const transcriptionResponseSchema = z.object({
  /** Transcribed text. Shown to the developer for editing; never sent automatically. */
  text: z.string(),
  audioMs: z.number().int().nonnegative(),
  model: z.string(),
});
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;

export const regionSchema = z.object({
  x1: z.number().int(),
  y1: z.number().int(),
  x2: z.number().int(),
  y2: z.number().int(),
});
export type Region = z.infer<typeof regionSchema>;

export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const SCREENSHOT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const createScreenshotRequestSchema = z.object({
  /** Concrete noun phrase naming one kind of object, e.g. "button" or "text box". */
  phrase: z.string().trim().min(2).max(80),
  mimeType: z.enum(SCREENSHOT_MIME_TYPES),
  /** Base64 image bytes (no data: prefix). */
  data: z.string().min(1),
  fileName: z.string().trim().max(120).optional(),
});
export type CreateScreenshotRequest = z.infer<typeof createScreenshotRequestSchema>;

/** A screenshot with regions found by SAM 3.1 — observed evidence of what the UI showed. */
export const screenshotSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  phrase: z.string(),
  fileName: z.string().nullable(),
  mimeType: z.enum(SCREENSHOT_MIME_TYPES),
  width: z.number().int(),
  height: z.number().int(),
  regions: z.array(regionSchema),
  model: z.string(),
  createdAt: z.string().datetime(),
});
export type Screenshot = z.infer<typeof screenshotSchema>;
