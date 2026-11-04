import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createScreenshotRequestSchema,
  idParamSchema,
  screenshotSchema,
  transcriptionResponseSchema,
} from "@bytewise/shared";
import type { MediaService } from "../services/media.service";

const sessionParamsSchema = z.object({ sessionId: idParamSchema });
const screenshotParamsSchema = z.object({ screenshotId: idParamSchema });

export function mediaRoutes(deps: { mediaService: MediaService }) {
  const { mediaService } = deps;

  return async (app: FastifyInstance) => {
    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: 4 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );

    // Voice input: raw PCM16 24 kHz mono. Returns text for the developer to edit.
    app.post("/transcriptions", async (request) => {
      if (!Buffer.isBuffer(request.body)) {
        throw Object.assign(new Error("Send audio as application/octet-stream."), {
          statusCode: 415,
        });
      }
      return transcriptionResponseSchema.parse(await mediaService.transcribe(request.body));
    });

    app.post(
      "/sessions/:sessionId/screenshots",
      { bodyLimit: 6 * 1024 * 1024 },
      async (request, reply) => {
        const { sessionId } = sessionParamsSchema.parse(request.params);
        const input = createScreenshotRequestSchema.parse(request.body);
        return reply
          .status(201)
          .send(screenshotSchema.parse(await mediaService.createScreenshot(sessionId, input)));
      },
    );

    app.get("/screenshots/:screenshotId/image", async (request, reply) => {
      const { screenshotId } = screenshotParamsSchema.parse(request.params);
      const { file, mimeType } = mediaService.image(screenshotId);
      return reply
        .header("Content-Type", mimeType)
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'")
        .header("Cache-Control", "private, max-age=3600")
        .send(fs.createReadStream(file));
    });
  };
}
