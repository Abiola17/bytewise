import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSystemPrompt, runAgentTurn, type AgentStep } from "../src/agent/agent";
import {
  outputForModel,
  runScriptTool,
  type RunHost,
  type RunRequest,
  type RunResult,
} from "../src/agent/run-tools";
import { createNodeWorkspaceFs } from "../src/agent/workspace-fs";
import type { ChatMessage, ChatResult, MetaClient } from "../src/meta/meta-client";

let root: string;

function project(scripts: Record<string, string>) {
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", scripts }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-run-"));
  project({
    test: `node -e "console.log('ok 1'); process.exit(0)"`,
    "test:fail": `node -e "console.error('AssertionError: expected 200'); process.exit(1)"`,
    "test:slow": `node -e "setInterval(()=>{},1000)"`,
    "test:env": `node -e "console.log('KEY=' + (process.env.META_API_KEY || 'absent'))"`,
    start: "node server.js",
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function host(answer: "approved" | "skipped" = "approved") {
  const log: Array<[string, RunRequest, RunResult?]> = [];
  const h: RunHost & { log: typeof log } = {
    log,
    async requestRun(r) {
      log.push(["request", r]);
      return answer;
    },
    onRunStarted(r) {
      log.push(["started", r]);
    },
    onRunFinished(r, result) {
      log.push(["finished", r, result]);
    },
  };
  return h;
}

const limits = { timeoutMs: 20_000, maxOutputChars: 10_000, killGraceMs: 300 };
let n = 0;
const run = (
  h: RunHost,
  script: string,
  extra: { signal?: AbortSignal; timeoutMs?: number } = {},
) =>
  runScriptTool({
    cwd: root,
    host: h,
    rawArguments: JSON.stringify({ script, reason: "verify the fix" }),
    newId: () => `r${n++}`,
    limits: { ...limits, timeoutMs: extra.timeoutMs ?? limits.timeoutMs },
    signal: extra.signal,
  });

describe("run_script", () => {
  it("asks first, runs the real script, and reports PASSED only for exit code 0", async () => {
    const h = host();
    const out = await run(h, "test");
    expect(h.log.map((l) => l[0])).toEqual(["request", "started", "finished"]);
    expect(h.log[0]![1]).toMatchObject({
      script: "test",
      label: "npm run test",
      reason: "verify the fix",
    });
    expect(out.ok).toBe(true);
    expect(out.output).toMatch(/^npm run test → PASSED \(exit code 0, [\d.]+s\)/);
    expect(out.output).toContain("ok 1");
  });

  it("reports failures with the real output", async () => {
    const h = host();
    const out = await run(h, "test:fail");
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(/→ FAILED \(exit code 1/);
    expect(out.output).toContain("AssertionError: expected 200");
    expect(h.log[2]![2]).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it("never runs a script the developer skipped", async () => {
    const h = host("skipped");
    const out = await run(h, "test");
    expect(h.log.map((l) => l[0])).toEqual(["request"]);
    expect(out.output).toMatch(/chose not to run.*Do not claim the change is verified/);
  });

  it.each(["start", "deploy", "test && rm -rf /", "../test", "typecheck"])(
    "refuses %j without asking or running",
    async (script) => {
      const h = host();
      const out = await run(h, script);
      expect(out.ok).toBe(false);
      expect(h.log).toHaveLength(0);
      expect(out.output).toMatch(
        /Allowed scripts in this project: test, test:fail, test:slow, test:env/,
      );
    },
  );

  it("stops at the time limit", async () => {
    const out = await run(host(), "test:slow", { timeoutMs: 800 });
    expect(out.output).toMatch(/→ TIMED OUT/);
  }, 15_000);

  it("stops when the developer presses Stop", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const h = host();
    const out = await run(h, "test:slow", { signal: controller.signal });
    expect(out.output).toMatch(/→ CANCELLED by the developer/);
    expect(h.log[2]![2]).toMatchObject({ status: "cancelled" });
  }, 15_000);

  it("does not pass the extension's secrets to the script", async () => {
    process.env.META_API_KEY = "LLM|should-not-leak";
    try {
      const out = await run(host(), "test:env");
      expect(out.output).toContain("KEY=absent");
      expect(out.output).not.toContain("should-not-leak");
    } finally {
      delete process.env.META_API_KEY;
    }
  });

  it("explains when the workspace is not on this machine", async () => {
    const out = await runScriptTool({
      cwd: null,
      host: host(),
      rawArguments: '{"script":"test","reason":""}',
      newId: () => "x",
      limits,
    });
    expect(out.output).toMatch(/not on the local disk/);
  });

  it("keeps the start and end of long output for the model", () => {
    const result = {
      status: "failed" as const,
      exitCode: 1,
      durationMs: 1,
      stdout: `FIRST ${"x".repeat(20_000)} LAST`,
      stderr: "",
      errorMessage: null,
    };
    const text = outputForModel(result, 1000);
    expect(text.startsWith("FIRST")).toBe(true);
    expect(text.endsWith("LAST")).toBe(true);
    expect(text).toMatch(/characters omitted/);
  });
});

describe("agent: fix, then verify", () => {
  it("runs the script after an edit and only the real result reaches the model", async () => {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/a.js"), "module.exports = 1;\n");
    const calls: ChatMessage[][] = [];
    const replies: Array<Partial<ChatResult>> = [
      {
        toolCalls: [
          { id: "c1", name: "run_script", arguments: '{"script":"test:fail","reason":"check"}' },
        ],
      },
      {
        toolCalls: [
          { id: "c2", name: "run_script", arguments: '{"script":"test","reason":"re-check"}' },
        ],
      },
      { content: "Verified: npm run test passed." },
    ];
    const client = {
      model: "t",
      async chat(req: { messages: ChatMessage[] }) {
        calls.push(req.messages);
        return {
          content: null,
          toolCalls: [],
          finishReason: "stop",
          model: "t",
          ...(replies.shift() ?? { content: "done" }),
        };
      },
    } as unknown as MetaClient;
    const steps: AgentStep[] = [];
    const ws = createNodeWorkspaceFs(root);
    const result = await runAgentTurn({
      client,
      fs: ws,
      history: [{ role: "user", content: "fix and verify" }],
      systemPrompt: agentSystemPrompt(ws.rootName, null, true, true),
      signal: new AbortController().signal,
      newId: () => `s${n++}`,
      callbacks: { onStep: (s) => steps.push(s), onStatus: () => {} },
      run: { host: host(), cwd: root, limits },
    });
    const toolResults = calls[2]!.filter((m) => m.role === "tool").map((m) => m.content);
    expect(toolResults[0]).toMatch(/FAILED/);
    expect(toolResults[1]).toMatch(/PASSED/);
    expect(steps.filter((s) => s.status !== "running").map((s) => s.status)).toEqual([
      "error",
      "done",
    ]);
    expect(result.reply).toBe("Verified: npm run test passed.");
    expect(agentSystemPrompt("x", null, true, true)).toMatch(
      /Only say a fix is verified when a run_script result says PASSED/,
    );
  });
});
