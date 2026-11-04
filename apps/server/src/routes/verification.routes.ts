import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  idParamSchema,
  startVerificationRequestSchema,
  verificationRunSchema,
} from "@bytewise/shared";
import type { VerificationService } from "../services/verification.service";

const sessionParamsSchema = z.object({ sessionId: idParamSchema });
const runParamsSchema = z.object({ verificationId: idParamSchema });

export function verificationRoutes(deps: { verificationService: VerificationService }) {
  const { verificationService } = deps;

  return async (app: FastifyInstance) => {
    // Starts an allowed command. Returns 202 with a `running` record (poll GET for
    // the result), or 200 with a `blocked` record if the policy refused it.
    app.post("/sessions/:sessionId/verifications", async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const { script } = startVerificationRequestSchema.parse(request.body);
      const run = verificationService.start(sessionId, script);
      return reply
        .status(run.status === "running" ? 202 : 200)
        .send(verificationRunSchema.parse(run));
    });

    app.get("/verifications/:verificationId", async (request) => {
      const { verificationId } = runParamsSchema.parse(request.params);
      return verificationRunSchema.parse(verificationService.get(verificationId));
    });
  };
}
