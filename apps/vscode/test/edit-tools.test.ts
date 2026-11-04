import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentTurn, type AgentStep } from "../src/agent/agent";
import {
  runEditTool,
  type EditDecision,
  type EditHost,
  type EditProposal,
} from "../src/agent/edit-tools";
import { computeEdit, editWarning, lineStats } from "../src/agent/edits";
import { createNodeWorkspaceFs, type WorkspaceFs } from "../src/agent/workspace-fs";
import type { ChatMessage, ChatResult, MetaClient } from "../src/meta/meta-client";

describe("computeEdit", () => {
  const src = "const a = 1;\nconst b = a + 1;\n";

  it("applies exact edits in order", () => {
    expect(
      computeEdit(src, [
        { find: "a = 1", replace: "a = 2" },
        { find: "a + 1", replace: "a + 2" },
      ]),
    ).toEqual({ ok: true, content: "const a = 2;\nconst b = a + 2;\n" });
  });

  it("rejects ambiguous, missing, empty and no-op edits", () => {
    expect(computeEdit(src, [{ find: "const", replace: "let" }])).toMatchObject({
      ok: false,
      problems: [expect.stringMatching(/occurs 2 times/)],
    });
    expect(computeEdit(src, [{ find: "nope", replace: "x" }])).toMatchObject({ ok: false });
    expect(computeEdit(src, [{ find: "", replace: "x" }])).toMatchObject({ ok: false });
    expect(computeEdit(src, [{ find: "a = 1", replace: "a = 1" }])).toMatchObject({ ok: false });
    expect(computeEdit(src, [])).toMatchObject({ ok: false });
  });

  it("keeps CRLF line endings and treats $ in replacements literally", () => {
    expect(computeEdit("x = 1;\r\ny = 2;\r\n", [{ find: "1;\ny", replace: "3;\ny" }])).toEqual({
      ok: true,
      content: "x = 3;\r\ny = 2;\r\n",
    });
    expect(computeEdit(src, [{ find: "a = 1", replace: "a = '$&'" }])).toMatchObject({
      content: expect.stringContaining("a = '$&'"),
    });
  });

  it("counts changed lines and flags sensitive kinds of files", () => {
    expect(lineStats("a\nb\n", "a\nc\n")).toEqual({ additions: 1, deletions: 1 });
    expect(editWarning("test/a.test.js")).toMatch(/test file/);
    expect(editWarning("package.json")).toMatch(/package.json/);
    expect(editWarning("src/a.js")).toBeNull();
  });
});

let root: string;
let outside: string;
let ws: WorkspaceFs;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-edit-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-edit-outside-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/session.js"), "sign(config.secret);\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock");
  fs.symlinkSync(outside, path.join(root, "linkdir"));
  ws = createNodeWorkspaceFs(root);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

/** Records proposals and answers with a scripted decision; writes nothing itself. */
function host(decision: EditDecision): EditHost & { proposals: EditProposal[] } {
  const proposals: EditProposal[] = [];
  return {
    proposals,
    async requestApproval(p) {
      proposals.push(p);
      return decision;
    },
  };
}

let ids = 0;
const run = (h: EditHost, name: string, args: object) =>
  runEditTool({
    fs: ws,
    host: h,
    name,
    rawArguments: JSON.stringify(args),
    newId: () => `p${ids++}`,
  });

describe("edit_file / create_file", () => {
  it("builds a proposal from the current file and reports acceptance", async () => {
    const h = host({ decision: "accepted" });
    const out = await run(h, "edit_file", {
      path: "src/session.js",
      edits: [{ find: "config.secret", replace: "config.sessionSecret" }],
      explanation: "Use the configured key name.",
    });
    expect(h.proposals[0]).toMatchObject({
      kind: "edit",
      path: "src/session.js",
      before: "sign(config.secret);\n",
      after: "sign(config.sessionSecret);\n",
      additions: 1,
      deletions: 1,
      warning: null,
    });
    expect(out).toMatchObject({ ok: true, summary: "Applied edit to src/session.js (+1 −1)" });
  });

  it("tells the model about a rejection and not to retry", async () => {
    const out = await run(host({ decision: "rejected" }), "edit_file", {
      path: "src/session.js",
      edits: [{ find: "secret", replace: "key" }],
      explanation: "",
    });
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(/rejected.*unchanged.*Do not propose the same change again/s);
  });

  it("reports a failed write (e.g. stale file) so the model re-reads", async () => {
    const out = await run(
      host({ decision: "failed", reason: "src/session.js changed." }),
      "edit_file",
      {
        path: "src/session.js",
        edits: [{ find: "secret", replace: "key" }],
        explanation: "",
      },
    );
    expect(out.output).toMatch(/not applied: src\/session.js changed\. Read the file again/);
  });

  it.each([
    [
      "edit_file",
      { path: ".env", edits: [{ find: "1", replace: "2" }], explanation: "" },
      /secrets/,
    ],
    [
      "edit_file",
      { path: "pnpm-lock.yaml", edits: [{ find: "lock", replace: "x" }], explanation: "" },
      /Lockfiles/,
    ],
    [
      "edit_file",
      { path: "../x.js", edits: [{ find: "a", replace: "b" }], explanation: "" },
      /outside/,
    ],
    [
      "edit_file",
      { path: "linkdir/a.js", edits: [{ find: "a", replace: "b" }], explanation: "" },
      /does not exist|not a regular file/,
    ],
    [
      "edit_file",
      { path: "src/new.js", edits: [{ find: "a", replace: "b" }], explanation: "" },
      /create_file/,
    ],
    [
      "edit_file",
      { path: "src/session.js", edits: [{ find: "nope", replace: "b" }], explanation: "" },
      /occurs 0 times/,
    ],
    ["create_file", { path: "src/session.js", content: "x", explanation: "" }, /already exists/],
    ["create_file", { path: "linkdir/new.js", content: "x", explanation: "" }, /file or a link/],
    ["create_file", { path: ".env.local", content: "x", explanation: "" }, /secrets/],
  ])("refuses %s %j before asking the developer", async (name, args, reason) => {
    const h = host({ decision: "accepted" });
    const out = await run(h, name as string, args);
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(reason);
    expect(h.proposals).toHaveLength(0);
  });

  it("proposes new files, including in new folders", async () => {
    const h = host({ decision: "accepted" });
    const out = await run(h, "create_file", {
      path: "src/utils/format.js",
      content: "export const f = 1;\n",
      explanation: "Helper.",
    });
    expect(h.proposals[0]).toMatchObject({
      kind: "create",
      before: "",
      additions: 1,
      deletions: 0,
    });
    expect(out.summary).toBe("Applied new file src/utils/format.js (+1 −0)");
  });
});

describe("agent loop with edits", () => {
  function scripted(responses: Array<Partial<ChatResult>>) {
    const calls: ChatMessage[][] = [];
    const tools: string[][] = [];
    const client = {
      model: "t",
      async chat(req: { messages: ChatMessage[]; tools?: Array<{ name: string }> }) {
        calls.push(req.messages);
        tools.push((req.tools ?? []).map((t) => t.name));
        return {
          content: null,
          toolCalls: [],
          finishReason: "stop",
          model: "t",
          ...(responses.shift() ?? { content: "done" }),
        };
      },
    } as unknown as MetaClient;
    return { client, calls, tools };
  }

  it("offers edit tools only with an approval host and routes decisions back", async () => {
    const h = host({ decision: "accepted" });
    const { client, calls, tools } = scripted([
      {
        toolCalls: [
          {
            id: "c1",
            name: "edit_file",
            arguments: JSON.stringify({
              path: "src/session.js",
              edits: [{ find: "config.secret", replace: "config.sessionSecret" }],
              explanation: "Fix key name.",
            }),
          },
        ],
      },
      { content: "Applied the fix." },
    ]);
    const steps: AgentStep[] = [];
    const result = await runAgentTurn({
      client,
      fs: ws,
      history: [{ role: "user", content: "fix it" }],
      systemPrompt: "s",
      signal: new AbortController().signal,
      newId: () => `x${ids++}`,
      callbacks: { onStep: (s) => steps.push(s), onStatus: () => {} },
      editHost: h,
    });
    expect(tools[0]).toEqual([
      "list_files",
      "read_file",
      "search_files",
      "edit_file",
      "create_file",
    ]);
    expect(h.proposals).toHaveLength(1);
    expect(steps.at(-1)).toMatchObject({
      status: "done",
      summary: "Applied edit to src/session.js (+1 −1)",
    });
    expect(calls[1]!.at(-1)).toMatchObject({ role: "tool", toolCallId: "c1" });
    expect(result.reply).toBe("Applied the fix.");

    const readOnly = scripted([{ content: "ok" }]);
    await runAgentTurn({
      client: readOnly.client,
      fs: ws,
      history: [{ role: "user", content: "hi" }],
      systemPrompt: "s",
      signal: new AbortController().signal,
      newId: () => `y${ids++}`,
      callbacks: { onStep: () => {}, onStatus: () => {} },
    });
    expect(readOnly.tools[0]).toEqual(["list_files", "read_file", "search_files"]);
  });
});
