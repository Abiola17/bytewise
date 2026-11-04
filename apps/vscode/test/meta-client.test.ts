import { describe, expect, it } from "vitest";
import { createMetaClient, MetaApiError } from "../src/meta/meta-client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function client(fetchImpl: typeof fetch, apiKey = "LLM|test-key") {
  return createMetaClient({
    apiKey,
    baseUrl: "https://api.example.test/v1/",
    model: "muse-spark-1.3",
    timeoutMs: 5000,
    fetchImpl,
  });
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MetaApiError) return error.kind;
    throw error;
  }
  throw new Error("expected an error");
}

describe("Meta client", () => {
  it("sends an OpenAI-style request and returns the reply", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const c = client(async (url, init) => {
      sent = { url: String(url), init: init! };
      return json(200, {
        model: "muse-spark-1.3",
        choices: [{ finish_reason: "stop", message: { content: "Hello" } }],
      });
    });
    const result = await c.chat({
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "low",
    });
    expect(result).toEqual({
      content: "Hello",
      toolCalls: [],
      finishReason: "stop",
      model: "muse-spark-1.3",
    });
    expect(sent!.url).toBe("https://api.example.test/v1/chat/completions");
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer LLM|test-key",
    );
    expect(JSON.parse(String(sent!.init.body))).toMatchObject({
      model: "muse-spark-1.3",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "low",
      max_completion_tokens: 4000,
    });
  });

  it("sends tools and parses tool calls (verified Meta shape)", async () => {
    let body: Record<string, unknown> = {};
    const c = client(async (_url, init) => {
      body = JSON.parse(String(init!.body));
      return json(200, {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"src/a.js"}' },
                },
              ],
            },
          },
        ],
      });
    });
    const result = await c.chat({
      messages: [
        { role: "user", content: "look" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_0", name: "list_files", arguments: "{}" }],
        },
        { role: "tool", content: "a.js", toolCallId: "call_0" },
      ],
      tools: [{ name: "read_file", description: "Read a file", parameters: { type: "object" } }],
    });
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "read_file", arguments: '{"path":"src/a.js"}' },
    ]);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "read_file", description: "Read a file", parameters: { type: "object" } },
      },
    ]);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        { id: "call_0", type: "function", function: { name: "list_files", arguments: "{}" } },
      ],
    });
    expect(messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_0" });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "server"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    expect(await kindOf(client(async () => json(status, {})).chat({ messages: [] }))).toBe(kind);
  });

  it("reports a missing key without calling the API", async () => {
    const c = client(async () => {
      throw new Error("must not be called");
    }, "");
    expect(await kindOf(c.chat({ messages: [] }))).toBe("no_key");
  });

  it("reports network failures and malformed responses", async () => {
    const offline = client(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await kindOf(offline.chat({ messages: [] }))).toBe("network");
    expect(
      await kindOf(client(async () => json(200, { choices: [] })).chat({ messages: [] })),
    ).toBe("invalid_response");
  });

  it("never puts the API key in error messages", async () => {
    const c = client(async () => json(401, { error: "bad key LLM|test-key" }));
    await c.chat({ messages: [] }).catch((error: Error) => {
      expect(error.message).not.toContain("LLM|test-key");
    });
  });
});
