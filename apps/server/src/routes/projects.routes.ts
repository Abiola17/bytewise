import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  availableProjectsResponseSchema,
  createProjectRequestSchema,
  importProjectRequestSchema,
  importProjectResponseSchema,
  idParamSchema,
  projectListResponseSchema,
  projectSchema,
} from "@bytewise/shared";
import type { ProjectImportService } from "../services/project-import.service";
import type { ProjectService } from "../services/project.service";

const projectParamsSchema = z.object({ projectId: idParamSchema });

export function projectRoutes(deps: {
  projectService: ProjectService;
  projectImport: ProjectImportService;
}) {
  const { projectService, projectImport } = deps;

  return async (app: FastifyInstance) => {
    app.get("/projects", async () => {
      return projectListResponseSchema.parse({ projects: projectService.list() });
    });

    app.get("/projects/available", async () => {
      return availableProjectsResponseSchema.parse({ directories: projectService.listAvailable() });
    });

    app.post("/projects", async (request, reply) => {
      const input = createProjectRequestSchema.parse(request.body);
      const project = projectService.register(input);
      return reply.status(201).send(projectSchema.parse(project));
    });

    // Creates a new project from files uploaded in the browser (base64 encoded,
    // so the body limit allows ~25 MB of content plus overhead).
    app.post("/projects/import", { bodyLimit: 40 * 1024 * 1024 }, async (request, reply) => {
      const input = importProjectRequestSchema.parse(request.body);
      const result = await projectImport.importProject(input);
      return reply.status(201).send(importProjectResponseSchema.parse(result));
    });

    app.get("/projects/:projectId", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      return projectSchema.parse(projectService.get(projectId));
    });
  };
}
