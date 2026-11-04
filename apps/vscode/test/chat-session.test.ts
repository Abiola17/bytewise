import { describe, expect, it } from "vitest";
import { chatOnlyPrompt, createChatSession, trimHistory } from "../src/chat-session";
import {
  MetaApiError,
  type ChatMessage,
  type ChatResult,
  type MetaClient,
} from "../src/meta/meta-client";
import type { WorkspaceFs } from "../src/agent/workspace-fs";
import { isFromWebview, type ChatEntry } from "../src/protocol";
import { parseBlocks } from "../src/webview/markdown";

type Reply = Partial<ChatResult> | Error;

function fakeClient(replies: Reply[]) {
  const calls: ChatMessage[][] = [];
  const client = {
    model: "test",
    async chat({ messages }: { messages: ChatMessage[] }) {
      calls.push(messages);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return { content: "", toolCalls: [], finishReason: "stop", model: "test", ...next };
    },
  } as unknown as MetaClient;
  return { client, calls };
}

const emptyFs: WorkspaceFs = {
  rootName: "demo",
  async readDirectory() {
    return [{ name: "a.js", kind: "file" }];
  },
  async stat() {
    return { kind: "file", size: 10 };
  },
  async readText() {
    return "const a = 1;\n";
  },
};

function session(replies: Reply[], workspace: WorkspaceFs | null = emptyFs) {
  const fake = fakeClient(replies);
  let n = 0;
  const s = createChatSession({
    client: () => fake.client,
    workspace: () => workspace,
    editorContext: () => null,
    newId: () => `id${n++}`,
  });
  return { s, calls: fake.calls };
}

const text = (e: ChatEntry) =>
  e.role === "step" ? e.summary : e.role === "approval" ? e.path : e.text;

describe("chat session", () => {
  it("keeps the conversation, including tool exchanges, for follow-ups", async () => {
    const { s, calls } = session([
      { toolCalls: [{ id: "c1", name: "read_file", arguments: '{"path":"a.js"}' }] },
      { content: "a is 1" },
      { content: "Yes." },
    ]);
    const seen: ChatEntry[] = [];
    await s.send("what is a?", (e) => seen.push(e));
    await s.send("sure?", (e) => seen.push(e));

    expect(seen.filter((e) => e.role !== "step").map((e) => [e.role, text(e)])).toEqual([
      ["user", "what is a?"],
      ["assistant", "a is 1"],
      ["user", "sure?"],
      ["assistant", "Yes."],
    ]);
    // Second turn carries: user, assistant(tool call), tool result, assistant reply, user.
    expect(calls[2]!.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(s.entries.filter((e) => e.role === "step")).toHaveLength(1);
  });

  it("chats without tools when no folder is open", async () => {
    const { s, calls } = session([{ content: "Open a folder first." }], null);
    await s.send("look at my code", () => {});
    expect(calls[0]![0]!.content).toBe(chatOnlyPrompt());
  });

  it("shows errors and does not keep the failed turn in model history", async () => {
    const { s, calls } = session([
      new MetaApiError("auth", "The Meta API rejected the API key."),
      { content: "ok" },
    ]);
    const seen: ChatEntry[] = [];
    await s.send("first", (e) => seen.push(e));
    expect(seen[1]).toMatchObject({ role: "error", text: "The Meta API rejected the API key." });
    expect(s.busy).toBe(false);
    await s.send("second", (e) => seen.push(e));
    expect(calls[1]!.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["second"]);
  });

  it("reports a stop as a plain message, not an error", async () => {
    const { s } = session([new MetaApiError("cancelled", "Stopped.")]);
    const seen: ChatEntry[] = [];
    await s.send("go", (e) => seen.push(e));
    expect(seen.at(-1)).toMatchObject({ role: "assistant", text: "Stopped." });
  });

  it("ignores empty messages and resets", async () => {
    const { s, calls } = session([{ content: "x" }]);
    await s.send("   ", () => {});
    expect(calls).toHaveLength(0);
    await s.send("hi", () => {});
    s.reset();
    expect(s.entries).toEqual([]);
  });

  it("trims history at a user message, never in the middle of a tool exchange", () => {
    const turn = (n: number): ChatMessage[] => [
      { role: "user", content: `q${n}` },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: `c${n}`, name: "list_files", arguments: "{}" }],
      },
      { role: "tool", content: "x", toolCallId: `c${n}` },
      { role: "assistant", content: `a${n}` },
    ];
    const long = Array.from({ length: 20 }, (_, i) => turn(i)).flat();
    const trimmed = trimHistory(long);
    expect(trimmed.length).toBeLessThanOrEqual(60);
    expect(trimmed[0]!.role).toBe("user");
  });
});

describe("webview message guard", () => {
  it("accepts known messages and rejects anything else", () => {
    expect(isFromWebview({ type: "send", text: "hi" })).toBe(true);
    expect(isFromWebview({ type: "stop" })).toBe(true);
    expect(isFromWebview({ type: "openFile", path: "src/a.js", line: 3 })).toBe(true);
    expect(isFromWebview({ type: "openFile", path: "src/a.js", line: -1 })).toBe(false);
    expect(isFromWebview({ type: "openFile", path: 7 })).toBe(false);
    expect(isFromWebview({ type: "send", text: 42 })).toBe(false);
    expect(isFromWebview({ type: "send", text: "x".repeat(20_001) })).toBe(false);
    expect(isFromWebview({ type: "runCommand", cmd: "rm -rf /" })).toBe(false);
    expect(isFromWebview(null)).toBe(false);
  });
});

describe("markdown parser", () => {
  it("splits replies into code, headings, lists and paragraphs", () => {
    const blocks = parseBlocks(
      "## Cause\nThe key is `undefined`.\n\n```js\nconst a = 1;\n```\n- one\n- two\n1. first",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "code", "list", "list"]);
    expect(blocks[2]).toMatchObject({ language: "js", lines: ["const a = 1;"] });
    expect(blocks[3]).toMatchObject({ ordered: false, lines: ["one", "two"] });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  it("treats HTML in replies as plain text lines", () => {
    const [block] = parseBlocks("<img src=x onerror=alert(1)>");
    expect(block).toEqual({ kind: "paragraph", lines: ["<img src=x onerror=alert(1)>"] });
  });

  it("handles an unclosed code fence", () => {
    expect(parseBlocks("```\nopen")).toEqual([
      { kind: "code", language: undefined, lines: ["open"] },
    ]);
  });
});
