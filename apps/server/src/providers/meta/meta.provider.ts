import type { AppConfig } from "../../config/env";
import { createOpenAICompatibleProvider } from "../openai-compatible";

/** Meta Model API (https://api.meta.ai/v1): OpenAI-compatible Chat Completions. */
export function createMetaProvider(config: AppConfig, fetchImpl?: typeof fetch) {
  return createOpenAICompatibleProvider({
    name: "Meta",
    baseUrl: config.env.META_BASE_URL,
    apiKey: config.env.META_API_KEY,
    model: config.env.META_MODEL,
    timeoutMs: config.env.MODEL_TIMEOUT_MS,
    maxTokensField: "max_completion_tokens",
    supportsReasoningEffort: true,
    fetchImpl,
  });
}
