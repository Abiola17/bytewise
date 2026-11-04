import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunLimits {
  timeoutMs: number;
  /** Characters kept per stream; the middle is dropped beyond this. */
  maxOutputChars: number;
  /** Grace period between SIGTERM and SIGKILL. */
  killGraceMs: number;
}

export interface ProcessResult {
  outcome: "exited" | "timed_out" | "spawn_error";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
  errorMessage: string | null;
}

/** Keeps the first and last part of a stream; tests report failures at both ends. */
class CappedBuffer {
  private head = "";
  private tail = "";
  private dropped = 0;
  constructor(private readonly max: number) {}

  push(chunk: string) {
    const headMax = Math.floor(this.max / 4);
    if (this.head.length < headMax) {
      const take = chunk.slice(0, headMax - this.head.length);
      this.head += take;
      chunk = chunk.slice(take.length);
    }
    this.tail += chunk;
    const tailMax = this.max - headMax;
    if (this.tail.length > tailMax) {
      this.dropped += this.tail.length - tailMax;
      this.tail = this.tail.slice(-tailMax);
    }
  }

  get truncated() {
    return this.dropped > 0;
  }

  toString() {
    return this.dropped > 0
      ? `${this.head}\n…[${this.dropped} characters omitted]…\n${this.tail}`
      : this.head + this.tail;
  }
}

/**
 * A minimal environment for project code: enough to find tools, nothing that
 * identifies or authenticates Bytewise (no API keys, tokens or server config).
 */
export function restrictedEnv(tempDir: string): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "LANG", "LC_ALL", "SHELL", "USER", "SYSTEMROOT", "COMSPEC"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return {
    ...env,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    CI: "true",
    NODE_ENV: "test",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

/**
 * Runs a command without a shell (arguments are passed as an array) in its own
 * process group, so a timeout kills the whole tree it started.
 */
export function runProcess(
  file: string,
  args: string[],
  options: { cwd: string; limits: RunLimits },
): Promise<ProcessResult> {
  const { cwd, limits } = options;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-run-"));
  const stdout = new CappedBuffer(limits.maxOutputChars);
  const stderr = new CappedBuffer(limits.maxOutputChars);
  const started = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (
      result: Omit<ProcessResult, "stdout" | "stderr" | "outputTruncated" | "durationMs">,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      resolve({
        ...result,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        outputTruncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - started,
      });
    };

    const child = spawn(file, args, {
      cwd,
      env: restrictedEnv(tempDir),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already exited.
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      killTimer = setTimeout(() => killTree("SIGKILL"), limits.killGraceMs);
    }, limits.timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => stderr.push(chunk));

    child.on("error", (error) => {
      finish({
        outcome: "spawn_error",
        exitCode: null,
        signal: null,
        errorMessage: `Could not start "${file}": ${error.message}`,
      });
    });

    child.on("close", (code, signal) => {
      // Make sure nothing the command started outlives it.
      killTree("SIGKILL");
      finish({
        outcome: timedOut ? "timed_out" : "exited",
        exitCode: code,
        signal,
        errorMessage: timedOut
          ? `Killed after exceeding the ${Math.round(limits.timeoutMs / 1000)}s time limit.`
          : null,
      });
    });
  });
}
