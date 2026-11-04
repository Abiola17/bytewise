import type { FastifyInstance } from "fastify";
import { healthResponseSchema, type HealthResponse } from "@bytewise/shared";
import type { AppConfig } from "../config/env";

export function healthRoutes(deps: { config: AppConfig; pingDatabase: () => boolean }) {
  return async (app: FastifyInstance) => {
    app.get("/health", async (): Promise<HealthResponse> => {
      return healthResponseSchema.parse({
        status: "ok",
        version: "0.1.0",
        database: deps.pingDatabase() ? "ok" : "error",
        modelProvider: deps.config.modelProvider,
        time: new Date().toISOString(),
      });
    });
  };
}
