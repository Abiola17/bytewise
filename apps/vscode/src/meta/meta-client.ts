/**
 * Meta Model API client (OpenAI-compatible Chat Completions), verified
 * 2026-11-04: Bearer auth, `max_completion_tokens`, `reasoning_effort`,
 * tool calling. No streaming. No VS Code imports, so it is unit-testable.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string produced by the model. Untrusted: parse and validate before use. */
  arguments: string;
}

/** Multimodal content (verified with muse-spark-1.3: text plus image data URLs). */
export type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | null | ContentPart[];
  toolCalls?: ToolCall[];
  /** For role "tool": which call this is the result of. */
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  model: string;
}

export type MetaErrorKind =
  | "no_key"
  | "cancelled"
  | "auth"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server"
  | "invalid_response";

export class MetaApiError extends Error {
  constructor(
    readonly kind: MetaErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export interface MetaClientOptions {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface WireMessage {
  role: ChatRole;
  content: string | null | ContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toWire(message: ChatMessage): WireMessage {
  const wire: WireMessage = { role: message.role, content: message.content };
  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: c.arguments },
    }));
  }
  if (message.toolCallId) wire.tool_call_id = message.toolCallId;
  return wire;
}

export function createMetaClient(options: MetaClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    model: options.model,

    async chat(request: {
      messages: ChatMessage[];
      tools?: ToolDefinition[];
      maxOutputTokens?: number;
      reasoningEffort?: "minimal" | "low" | "medium" | "high";
      /** Cancels the request (e.g. the developer pressed Stop). */
      signal?: AbortSignal;
    }): Promise<ChatResult> {
      if (!options.apiKey) {
        throw new MetaApiError(
          "no_key",
          "No Meta API key is set. Run “Bytewise: Set Meta API Key” from the Command Palette.",
        );
      }

      const body: Record<string, unknown> = {
        model: options.model,
        messages: request.messages.map(toWire),
        max_completion_tokens: request.maxOutputTokens ?? 4000,
      };
      if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = "auto";
      }

      let res: Response;
      try {
        res = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs)])
            : AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (request.signal?.aborted) throw new MetaApiError("cancelled", "Stopped.");
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new MetaApiError(
            "timeout",
            `The Meta API did not respond within ${Math.round(options.timeoutMs / 1000)}s.`,
          );
        }
        throw new MetaApiError("network", "Could not reach the Meta API. Check your connection.");
      }

      if (res.status === 401 || res.status === 403) {
        throw new MetaApiError(
          "auth",
          "The Meta API rejected the API key. Set a new one with “Bytewise: Set Meta API Key”.",
        );
      }
      if (res.status === 429) {
        throw new MetaApiError(
          "rate_limited",
          "The Meta API is rate limiting requests. Try again shortly.",
        );
      }
      if (!res.ok) {
        throw new MetaApiError("server", `The Meta API request failed (HTTP ${res.status}).`);
      }

      const json = (await res.json().catch(() => null)) as {
        model?: string;
        choices?: Array<{
          finish_reason?: string | null;
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
      } | null;
      const choice = json?.choices?.[0];
      if (!choice?.message) {
        throw new MetaApiError("invalid_response", "The Meta API returned an unexpected response.");
      }

      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
        .filter((c) => typeof c.id === "string" && typeof c.function?.name === "string")
        .map((c) => ({
          id: c.id!,
          name: c.function!.name!,
          arguments: c.function!.arguments ?? "{}",
        }));

      return {
        content: choice.message.content ?? null,
        toolCalls,
        finishReason: choice.finish_reason ?? null,
        model: json?.model ?? options.model,
      };
    },
  };
}

export type MetaClient = ReturnType<typeof createMetaClient>;
