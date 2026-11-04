/** An expected, user-facing failure with a stable code and HTTP status. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} was not found.`);

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

export const conflict = (message: string) => new AppError(409, "conflict", message);
