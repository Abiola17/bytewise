import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  availableProjectsResponseSchema,
  createProjectRequestSchema,
  idParamSchema,
  projectListResponseSchema,
  projectSchema,
} from "@bytewise/shared";
import type { ProjectService } from "../services/project.service";

const projectParamsSchema = z.object({ projectId: idParamSchema });

export function projectRoutes(deps: { projectService: ProjectService }) {
  const { projectService } = deps;

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

    app.get("/projects/:projectId", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      return projectSchema.parse(projectService.get(projectId));
    });
  };
}
