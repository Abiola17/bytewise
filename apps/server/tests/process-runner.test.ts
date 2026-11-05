import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/execution/process-runner";
import {
  listVerificationCommands,
  resolveVerificationCommand,
} from "../src/execution/command-policy";
import { statusFor } from "../src/services/verification.service";

const limits = { timeoutMs: 5000, maxOutputChars: 10_000, killGraceMs: 500 };
const node = (code: string, overrides = {}) =>
  runProcess(process.execPath, ["-e", code], {
    cwd: os.tmpdir(),
    limits: { ...limits, ...overrides },
  });

describe("runProcess", () => {
  it("captures stdout, stderr and a zero exit code", async () => {
    const result = await node("console.log('out'); console.error('err')");
    expect(result).toMatchObject({ outcome: "exited", exitCode: 0, outputTruncated: false });
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(statusFor(result)).toBe("passed");
  });

  it("reports a non-zero exit as failed", async () => {
    const result = await node("process.exit(3)");
    expect(result.exitCode).toBe(3);
    expect(statusFor(result)).toBe("failed");
  });

  it("kills the process tree at the time limit", async () => {
    const started = Date.now();
    const result = await node(
      "require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'inherit' }); setInterval(()=>{}, 1000)",
      { timeoutMs: 500 },
    );
    expect(result.outcome).toBe("timed_out");
    expect(statusFor(result)).toBe("timed_out");
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.errorMessage).toMatch(/time limit/);
  });

  it("keeps the head and tail of oversized output", async () => {
    const result = await node(
      "console.log('FIRST'); for (let i = 0; i < 5000; i++) console.log('line ' + i); console.log('LAST')",
      { maxOutputChars: 2000 },
    );
    expect(result.outputTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(2200);
    expect(result.stdout).toMatch(/^FIRST/);
    expect(result.stdout).toMatch(/LAST\n$/);
    expect(result.stdout).toMatch(/characters omitted/);
  });

  it("does not pass the server's secrets to the child", async () => {
    process.env.META_API_KEY = "LLM|test-secret-value";
    try {
      const result = await node("console.log(JSON.stringify(process.env))");
      const env = JSON.parse(result.stdout);
      expect(env.META_API_KEY).toBeUndefined();
      expect(result.stdout).not.toContain("test-secret-value");
      expect(env.CI).toBe("true");
      expect(env.PATH).toBeTruthy();
    } finally {
      delete process.env.META_API_KEY;
    }
  });

  it("reports a missing executable as an error, not a failure", async () => {
    const result = await runProcess("definitely-not-a-real-binary-xyz", [], {
      cwd: os.tmpdir(),
      limits,
    });
    expect(result.outcome).toBe("spawn_error");
    expect(statusFor(result)).toBe("error");
  });
});

describe("command policy", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-policy-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node --test",
          "test:unit": "node --test unit",
          lint: "eslint .",
          start: "node server.js",
          deploy: "rm -rf /",
        },
      }),
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lists only allowed scripts that exist", () => {
    expect(listVerificationCommands(root).map((c) => c.script)).toEqual([
      "test",
      "test:unit",
      "lint",
    ]);
    expect(listVerificationCommands(root)[0]).toEqual({
      script: "test",
      label: "npm run test",
      definition: "node --test",
    });
  });

  it.each(["start", "deploy", "test; rm -rf /", "../test", ""])("blocks %j", (script) => {
    expect(resolveVerificationCommand(root, script).allowed).toBe(false);
  });

  it("blocks an allowed name that package.json does not define", () => {
    const res = resolveVerificationCommand(root, "typecheck");
    expect(res).toMatchObject({ allowed: false });
  });

  it("uses the project's package manager", () => {
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
    const res = resolveVerificationCommand(root, "test");
    expect(res).toMatchObject({ allowed: true, command: { file: "pnpm", args: ["run", "test"] } });
  });
});

describe("runProcess cancellation", () => {
  it("kills the process tree when the signal aborts, and never reports it as a test result", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const run = runProcess(
      process.execPath,
      [
        "-e",
        "require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'inherit' }); setInterval(()=>{}, 1000)",
      ],
      {
        cwd: os.tmpdir(),
        limits: { timeoutMs: 20_000, maxOutputChars: 1000, killGraceMs: 300 },
        signal: controller.signal,
      },
    );
    setTimeout(() => controller.abort(), 300);
    const result = await run;
    expect(result.outcome).toBe("cancelled");
    expect(result.errorMessage).toMatch(/Stopped/);
    expect(statusFor(result)).toBe("error");
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
