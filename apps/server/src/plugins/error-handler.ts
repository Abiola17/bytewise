import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { ApiError } from "@bytewise/shared";
import { AppError } from "../errors/app-error";

/** Maps every thrown error to the shared `ApiError` body. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.warn({ code: error.code }, error.message);
      const body: ApiError = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      const body: ApiError = {
        error: {
          code: "validation_failed",
          message: "The request did not match the expected format.",
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      };
      return reply.status(400).send(body);
    }

    // Fastify's own client errors (malformed JSON, payload too large, ...).
    const { statusCode, message } = error as { statusCode?: number; message?: string };
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const body: ApiError = { error: { code: "bad_request", message: message ?? "Bad request." } };
      return reply.status(statusCode).send(body);
    }

    request.log.error({ err: error }, "unhandled error");
    const body: ApiError = {
      error: { code: "internal_error", message: "An unexpected server error occurred." },
    };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = {
      error: { code: "not_found", message: `Route ${request.method} ${request.url} not found.` },
    };
    return reply.status(404).send(body);
  });
}
