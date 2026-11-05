import fs from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createScreenshotRequestSchema,
  idParamSchema,
  screenshotSchema,
  transcriptionResponseSchema,
} from "@bytewise/shared";
import { MAX_LIVE_AUDIO_BYTES, type MediaService } from "../services/media.service";
import { AppError } from "../errors/app-error";
import type { MessageImagesService } from "../services/message-images.service";

const sessionParamsSchema = z.object({ sessionId: idParamSchema });
const screenshotParamsSchema = z.object({ screenshotId: idParamSchema });
const imageParamsSchema = z.object({ imageId: idParamSchema });

export function mediaRoutes(deps: {
  mediaService: MediaService;
  messageImages: MessageImagesService;
  /** Only the web app may open the live voice socket (CORS does not cover WebSockets). */
  webOrigin: string;
}) {
  const { mediaService, messageImages, webOrigin } = deps;
  const sendImage = (reply: FastifyReply, { file, mimeType }: { file: string; mimeType: string }) =>
    reply
      .header("Content-Type", mimeType)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'")
      .header("Cache-Control", "private, max-age=3600")
      .send(fs.createReadStream(file));

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

    /**
     * Live dictation. The browser sends binary PCM16 24 kHz mono chunks, then
     * {"type":"stop"}. The server answers {"type":"text"} as words are recognized,
     * one {"type":"final"} (or {"type":"error"}), then closes. The Meta key never
     * leaves the server, and nothing is sent to the agent.
     */
    app.get(
      "/transcriptions/live",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          if (request.headers.origin !== new URL(webOrigin).origin) {
            return reply
              .code(403)
              .send({ error: { code: "forbidden", message: "Origin not allowed." } });
          }
        },
      },
      (socket) => {
        const send = (message: object) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
        };
        let received = 0;
        let ended = false;
        let live: ReturnType<MediaService["liveTranscription"]>;
        try {
          live = mediaService.liveTranscription({
            onText: (text) => !ended && send({ type: "text", text }),
            onError: (error) => send({ type: "error", message: error.message }),
          });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof AppError ? error.message : "Voice input is unavailable.",
          });
          socket.close(1011);
          return;
        }

        const end = async () => {
          if (ended) return;
          ended = true;
          clearTimeout(limit);
          try {
            send({ type: "final", text: await live.finish() });
          } catch (error) {
            send({
              type: "error",
              message: error instanceof Error ? error.message : "Transcription failed.",
            });
          }
          socket.close(1000);
        };
        // Stop at the recording limit even if the browser never says so.
        const limit = setTimeout(() => void end(), (MAX_LIVE_AUDIO_BYTES / 48_000 + 15) * 1000);

        socket.on("message", (data: Buffer, isBinary: boolean) => {
          if (ended) return;
          if (!isBinary) {
            if (data.toString() === '{"type":"stop"}') void end();
            return;
          }
          received += data.length;
          if (received > MAX_LIVE_AUDIO_BYTES) {
            void end();
            return;
          }
          live.push(data);
        });
        socket.on("close", () => {
          clearTimeout(limit);
          if (!ended) {
            ended = true;
            live.cancel();
          }
        });
      },
    );

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
      return sendImage(reply, mediaService.image(screenshotId));
    });

    app.get("/message-images/:imageId/image", async (request, reply) => {
      const { imageId } = imageParamsSchema.parse(request.params);
      return sendImage(reply, messageImages.file(imageId));
    });
  };
}
