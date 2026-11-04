import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParamSchema, patchProposalSchema } from "@bytewise/shared";
import type { PatchService } from "../services/patch.service";

const sessionParamsSchema = z.object({ sessionId: idParamSchema });
const patchParamsSchema = z.object({ patchId: idParamSchema });

export function patchRoutes(deps: { patchService: PatchService }) {
  const { patchService } = deps;

  return async (app: FastifyInstance) => {
    // Generates a proposal. Never modifies project files.
    app.post("/sessions/:sessionId/patch-proposals", async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      return reply
        .status(201)
        .send(patchProposalSchema.parse(await patchService.propose(sessionId)));
    });

    app.get("/patches/:patchId", async (request) => {
      const { patchId } = patchParamsSchema.parse(request.params);
      return patchProposalSchema.parse(patchService.get(patchId));
    });

    // Explicit approval: revalidates against current files and applies atomically.
    app.post("/patches/:patchId/approve", async (request) => {
      const { patchId } = patchParamsSchema.parse(request.params);
      return patchProposalSchema.parse(await patchService.approve(patchId));
    });

    app.post("/patches/:patchId/reject", async (request) => {
      const { patchId } = patchParamsSchema.parse(request.params);
      return patchProposalSchema.parse(patchService.reject(patchId));
    });

    app.post("/patches/:patchId/revert", async (request) => {
      const { patchId } = patchParamsSchema.parse(request.params);
      return patchProposalSchema.parse(await patchService.revert(patchId));
    });
  };
}
