import { z } from "zod";
import type { ModelProvider, StructuredRequest, StructuredResponse } from "./model-provider";
import { providerErrors } from "./model-provider";

export interface OpenAICompatibleOptions {
  /** Display name used in errors, e.g. "Meta". */
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  /** Name of the output-token limit field the provider expects. */
  maxTokensField: "max_completion_tokens" | "max_tokens";
  supportsReasoningEffort: boolean;
  fetchImpl?: typeof fetch;
}

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .partial()
    .optional(),
});

/** Chat Completions client for OpenAI-compatible APIs (Meta Model API, Baseten). */
export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ModelProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: options.name.toLowerCase(),
    model: options.model,

    async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
      if (!options.apiKey) throw providerErrors.notConfigured(options.name.toLowerCase());

      const body: Record<string, unknown> = {
        model: options.model,
        messages: request.messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
        },
        [options.maxTokensField]: request.maxOutputTokens,
      };
      if (options.supportsReasoningEffort && request.reasoningEffort) {
        body.reasoning_effort = request.reasoningEffort;
      }

      let res: Response;
      try {
        res = await fetchImpl(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw providerErrors.timeout(options.name, options.timeoutMs);
        }
        throw providerErrors.unavailable(
          options.name,
          error instanceof Error ? error.message : "network error",
        );
      }

      if (res.status === 401 || res.status === 403) throw providerErrors.auth(options.name);
      if (res.status === 429) throw providerErrors.rateLimited(options.name);
      if (!res.ok) {
        // Error bodies are logged server-side by the caller, not echoed verbatim.
        throw providerErrors.unavailable(options.name, `HTTP ${res.status}`);
      }

      const parsed = completionSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw providerErrors.invalidResponse("unexpected completion format");

      const choice = parsed.data.choices[0]!;
      if (choice.message.refusal) {
        throw providerErrors.invalidResponse(`the model refused: ${choice.message.refusal}`);
      }
      if (choice.finish_reason === "length") {
        throw providerErrors.invalidResponse("the response was cut off at the token limit");
      }
      if (!choice.message.content) throw providerErrors.invalidResponse("empty response");

      const usage = parsed.data.usage;
      return {
        content: choice.message.content,
        model: parsed.data.model ?? options.model,
        usage:
          usage?.prompt_tokens !== undefined && usage.completion_tokens !== undefined
            ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
            : null,
      };
    },
  };
}
