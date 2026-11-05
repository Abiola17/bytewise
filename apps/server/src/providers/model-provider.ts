import { AppError } from "../errors/app-error";

/** OpenAI-style content parts; images are data URLs. */
export type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface StructuredRequest {
  messages: ChatMessage[];
  /** JSON Schema the response must follow (strict mode where supported). */
  schema: { name: string; schema: Record<string, unknown> };
  maxOutputTokens: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export interface StructuredResponse {
  /** Raw text returned by the model. Untrusted: callers must parse and validate. */
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Application-level model interface. Provider SDK/HTTP details stay inside
 * the implementations; the rest of the app only sees this contract.
 */
export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
}

/** Errors a provider can raise, mapped to HTTP statuses the frontend can explain. */
export const providerErrors = {
  notConfigured: (provider: string) =>
    new AppError(
      503,
      "provider_not_configured",
      `No API key is configured for the "${provider}" model provider. Add it to .env and restart the server.`,
    ),
  auth: (provider: string) =>
    new AppError(
      502,
      "provider_auth_failed",
      `The ${provider} API rejected the API key. Check the key in .env.`,
    ),
  rateLimited: (provider: string) =>
    new AppError(
      503,
      "provider_rate_limited",
      `The ${provider} API is rate limiting requests. Try again shortly.`,
    ),
  timeout: (provider: string, ms: number) =>
    new AppError(
      504,
      "provider_timeout",
      `The ${provider} API did not respond within ${Math.round(ms / 1000)}s.`,
    ),
  unavailable: (provider: string, detail: string) =>
    new AppError(502, "provider_unavailable", `The ${provider} API request failed: ${detail}`),
  invalidResponse: (detail: string) =>
    new AppError(
      502,
      "model_invalid_response",
      `The model's response could not be processed: ${detail}`,
    ),
};
