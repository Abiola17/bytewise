import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  evidenceRequestSchema,
  evidenceResponseSchema,
  fileContentQuerySchema,
  fileContentResponseSchema,
  fileListResponseSchema,
  idParamSchema,
  searchQuerySchema,
  searchResponseSchema,
} from "@bytewise/shared";
import type { ProjectFilesService } from "../services/project-files.service";

const projectParamsSchema = z.object({ projectId: idParamSchema });

export function fileRoutes(deps: { projectFiles: ProjectFilesService }) {
  const { projectFiles } = deps;

  return async (app: FastifyInstance) => {
    app.get("/projects/:projectId/files", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      return fileListResponseSchema.parse(await projectFiles.listFiles(projectId));
    });

    app.get("/projects/:projectId/files/content", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const { path } = fileContentQuerySchema.parse(request.query);
      return fileContentResponseSchema.parse(await projectFiles.readFile(projectId, path));
    });

    app.get("/projects/:projectId/search", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const { q, limit } = searchQuerySchema.parse(request.query);
      return searchResponseSchema.parse(await projectFiles.search(projectId, q, limit));
    });

    // Preview of the evidence the context engine would select for a request.
    // Read-only; Phase 3 stores evidence with the debugging session.
    app.post("/projects/:projectId/evidence", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const { query } = evidenceRequestSchema.parse(request.body);
      return evidenceResponseSchema.parse(await projectFiles.gatherEvidence(projectId, query));
    });
  };
}
