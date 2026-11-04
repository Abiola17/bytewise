import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error";
import { createOpenAICompatibleProvider } from "../src/providers/openai-compatible";

function provider(fetchImpl: typeof fetch, apiKey = "secret-key") {
  return createOpenAICompatibleProvider({
    name: "Meta",
    baseUrl: "https://api.example.test/v1",
    apiKey,
    model: "muse-spark-1.3",
    timeoutMs: 5000,
    maxTokensField: "max_completion_tokens",
    supportsReasoningEffort: true,
    fetchImpl,
  });
}

const request = {
  messages: [{ role: "user" as const, content: "hi" }],
  schema: { name: "s", schema: { type: "object" } },
  maxOutputTokens: 100,
  reasoningEffort: "low" as const,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected an error");
}

describe("OpenAI-compatible provider", () => {
  it("sends a strict json_schema chat completion with bearer auth", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const p = provider(async (url, init) => {
      sent = { url: String(url), init: init! };
      return json(200, {
        model: "muse-spark-1.3",
        choices: [{ finish_reason: "stop", message: { content: '{"ok":true}', refusal: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });

    const result = await p.generateStructured(request);
    expect(result).toEqual({
      content: '{"ok":true}',
      model: "muse-spark-1.3",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(sent!.url).toBe("https://api.example.test/v1/chat/completions");
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    const body = JSON.parse(String(sent!.init.body));
    expect(body).toMatchObject({
      model: "muse-spark-1.3",
      max_completion_tokens: 100,
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: "s", strict: true } },
    });
  });

  it.each([
    [401, "provider_auth_failed"],
    [403, "provider_auth_failed"],
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const p = provider(async () => json(status, { error: "x" }));
    expect(await errorCode(p.generateStructured(request))).toBe(code);
  });

  it("rejects truncated and empty responses", async () => {
    const truncated = provider(async () =>
      json(200, { choices: [{ finish_reason: "length", message: { content: '{"a"' } }] }),
    );
    expect(await errorCode(truncated.generateStructured(request))).toBe("model_invalid_response");

    const empty = provider(async () => json(200, { choices: [] }));
    expect(await errorCode(empty.generateStructured(request))).toBe("model_invalid_response");
  });

  it("fails fast without an API key", async () => {
    const p = provider(async () => {
      throw new Error("must not be called");
    }, "");
    expect(await errorCode(p.generateStructured(request))).toBe("provider_not_configured");
  });

  it("never includes the API key in error messages", async () => {
    const p = provider(async () => json(401, { error: "bad key secret-key" }));
    await p.generateStructured(request).catch((error: Error) => {
      expect(error.message).not.toContain("secret-key");
    });
  });
});
