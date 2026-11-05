import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSessionRequestSchema,
  debugSessionSchema,
  idParamSchema,
  postMessageRequestSchema,
  sessionDetailSchema,
  sessionListResponseSchema,
} from "@bytewise/shared";
import type { DebuggingService } from "../services/debugging.service";
import type { SessionService } from "../services/session.service";

const projectParamsSchema = z.object({ projectId: idParamSchema });
const sessionParamsSchema = z.object({ sessionId: idParamSchema });
const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function sessionRoutes(deps: {
  sessionService: SessionService;
  debuggingService: DebuggingService;
}) {
  const { sessionService, debuggingService } = deps;

  return async (app: FastifyInstance) => {
    app.get("/sessions", async (request) => {
      const { limit } = recentQuerySchema.parse(request.query);
      return sessionListResponseSchema.parse({ sessions: sessionService.listRecent(limit) });
    });

    app.get("/projects/:projectId/sessions", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      return {
        sessions: z.array(debugSessionSchema).parse(sessionService.listByProject(projectId)),
      };
    });

    app.post("/projects/:projectId/sessions", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const input = createSessionRequestSchema.parse(request.body ?? {});
      return reply
        .status(201)
        .send(debugSessionSchema.parse(sessionService.create(projectId, input)));
    });

    app.get("/sessions/:sessionId", async (request) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      return sessionDetailSchema.parse(sessionService.detail(sessionId));
    });

    // Submit a debugging request: stores it, gathers evidence and diagnoses.
    // Up to 4 images of 4 MB each, sent as base64.
    app.post("/sessions/:sessionId/messages", { bodyLimit: 24 * 1024 * 1024 }, async (request) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const { content, images } = postMessageRequestSchema.parse(request.body);
      return sessionDetailSchema.parse(
        await debuggingService.postMessage(sessionId, content, images),
      );
    });

    // Re-run diagnosis for the latest unanswered request.
    app.post("/sessions/:sessionId/diagnose", async (request) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      return sessionDetailSchema.parse(await debuggingService.retryDiagnosis(sessionId));
    });
  };
}
