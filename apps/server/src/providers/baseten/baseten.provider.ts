import type { AppConfig } from "../../config/env";
import { createOpenAICompatibleProvider } from "../openai-compatible";

/** Baseten Model APIs (https://inference.baseten.co/v1): OpenAI-compatible, hosts Muse Spark Open. */
export function createBasetenProvider(config: AppConfig, fetchImpl?: typeof fetch) {
  return createOpenAICompatibleProvider({
    name: "Baseten",
    baseUrl: config.env.BASETEN_BASE_URL,
    apiKey: config.env.BASETEN_API_KEY,
    model: config.env.BASETEN_MODEL,
    timeoutMs: config.env.MODEL_TIMEOUT_MS,
    maxTokensField: "max_tokens",
    supportsReasoningEffort: false,
    fetchImpl,
  });
}
