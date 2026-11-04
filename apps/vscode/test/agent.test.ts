import { describe, expect, it } from "vitest";
import { AGENT_LIMITS, runAgentTurn, runningLabel, type AgentStep } from "../src/agent/agent";
import type { WorkspaceFs } from "../src/agent/workspace-fs";
import type { ChatMessage, ChatResult, MetaClient, ToolCall } from "../src/meta/meta-client";

const files: Record<string, string> = {
  "src/session.js": "const s = createHmac('sha256', config.secret);\n",
  "src/config.js": "export const config = { sessionSecret: 'x' };\n",
};

const fs: WorkspaceFs = {
  rootName: "demo",
  async readDirectory(dir) {
    if (dir === "") return [{ name: "src", kind: "directory" }];
    if (dir === "src")
      return Object.keys(files).map((p) => ({ name: p.slice(4), kind: "file" as const }));
    throw new Error("missing");
  },
  async stat(rel) {
    if (rel === "src") return { kind: "directory", size: 0 };
    return rel in files ? { kind: "file", size: files[rel]!.length } : null;
  },
  async readText(rel) {
    return files[rel]!;
  },
};

function scripted(responses: Array<(messages: ChatMessage[]) => Partial<ChatResult>>) {
  const calls: Array<{ messages: ChatMessage[]; tools: boolean }> = [];
  const client = {
    model: "test",
    async chat(req: { messages: ChatMessage[]; tools?: unknown[]; signal?: AbortSignal }) {
      calls.push({ messages: req.messages, tools: Boolean(req.tools?.length) });
      const next = responses.shift() ?? (() => ({ content: "done" }));
      return {
        content: null,
        toolCalls: [],
        finishReason: "stop",
        model: "test",
        ...next(req.messages),
      };
    },
  } as unknown as MetaClient;
  return { client, calls };
}

const toolCall = (id: string, name: string, args: object): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

async function run(client: MetaClient, signal = new AbortController().signal) {
  const steps: AgentStep[] = [];
  let n = 0;
  const result = await runAgentTurn({
    client,
    fs,
    history: [{ role: "user", content: "Why does login fail?" }],
    systemPrompt: "system",
    signal,
    newId: () => `s${n++}`,
    callbacks: { onStep: (s) => steps.push(s), onStatus: () => {} },
  });
  return { result, steps };
}

describe("agent loop", () => {
  it("runs requested tools, feeds results back, and returns the final answer", async () => {
    const { client, calls } = scripted([
      () => ({
        toolCalls: [
          toolCall("c1", "search_files", { query: "config.secret" }),
          toolCall("c2", "read_file", { path: "src/config.js" }),
        ],
      }),
      () => ({
        content: "`src/session.js:1` reads `config.secret`, but config defines `sessionSecret`.",
      }),
    ]);
    const { result, steps } = await run(client);

    expect(result.stoppedEarly).toBeNull();
    expect(result.reply).toContain("sessionSecret");
    // Each tool reports "running" then its outcome, with the same id.
    expect(steps.map((s) => [s.id, s.status])).toEqual([
      ["s0", "running"],
      ["s0", "done"],
      ["s1", "running"],
      ["s1", "done"],
    ]);
    expect(steps[3]).toMatchObject({
      summary: "Read src/config.js (lines 1–1 of 1)",
      path: "src/config.js",
    });

    // The second model call received both tool results, linked to their call ids.
    const second = calls[1]!.messages;
    const toolResults = second.filter((m) => m.role === "tool");
    expect(toolResults.map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
    expect(toolResults[0]!.content).toContain("src/session.js:1:");
    expect(result.messages.map((m) => m.role)).toEqual(["assistant", "tool", "tool", "assistant"]);
  });

  it("returns tool errors to the model so it can recover", async () => {
    const { client, calls } = scripted([
      () => ({ toolCalls: [toolCall("c1", "read_file", { path: "../../etc/passwd" })] }),
      () => ({ content: "I can only read files inside the workspace." }),
    ]);
    const { steps } = await run(client);
    expect(steps.at(-1)).toMatchObject({ status: "error" });
    expect(calls[1]!.messages.at(-1)!.content).toMatch(/outside the workspace/);
  });

  it("stops at the step limit and asks for a final answer without tools", async () => {
    const loops = Array.from({ length: AGENT_LIMITS.maxSteps }, (_, i) => () => ({
      toolCalls: [toolCall(`c${i}`, "list_files", {})],
    }));
    const { client, calls } = scripted([...loops, () => ({ content: "Here is what I found." })]);
    const { result } = await run(client);
    expect(result.stoppedEarly).toBe("limit");
    expect(result.reply).toBe("Here is what I found.");
    expect(calls).toHaveLength(AGENT_LIMITS.maxSteps + 1);
    expect(calls.at(-1)!.tools).toBe(false);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    const { client, calls } = scripted([
      () => {
        controller.abort();
        return { toolCalls: [toolCall("c1", "list_files", {})] };
      },
    ]);
    const { result, steps } = await run(client, controller.signal);
    expect(result.stoppedEarly).toBe("cancelled");
    expect(steps).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("labels running steps from untrusted arguments safely", () => {
    expect(runningLabel("read_file", '{"path":"src/a.js"}')).toBe("Reading src/a.js…");
    expect(runningLabel("search_files", '{"query":"foo"}')).toBe('Searching for "foo"…');
    expect(runningLabel("read_file", "{bad")).toBe("Reading a file…");
  });
});
