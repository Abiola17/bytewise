import { z } from "zod";
import {
  listVerificationCommands,
  resolveVerificationCommand,
  runProcess,
  type ProcessResult,
  type RunLimits,
} from "@bytewise/execution";
import type { ToolDefinition } from "../meta/meta-client";
import type { ToolOutcome } from "./tools";

export type RunStatus = "passed" | "failed" | "timed_out" | "cancelled" | "error";

export interface RunRequest {
  id: string;
  script: string;
  /** What is executed, e.g. "npm run test". */
  label: string;
  /** The script body from package.json, e.g. "node --test". */
  definition: string;
  reason: string;
}

export interface RunResult {
  status: RunStatus;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}

/** Asks the developer before running, and shows progress and the real result. */
export interface RunHost {
  requestRun(request: RunRequest): Promise<"approved" | "skipped">;
  onRunStarted(request: RunRequest): void;
  onRunFinished(request: RunRequest, result: RunResult): void;
}

export const RUN_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "run_script",
    description:
      "Run one of the project's own package.json scripts to verify a change: test, test:*, typecheck, lint or check. The developer approves each run. Returns the real exit code and output. Only a run that passes proves a fix works.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["script", "reason"],
      properties: {
        script: { type: "string", description: 'Script name from package.json, e.g. "test".' },
        reason: { type: "string", description: "One sentence: why run it now." },
      },
    },
  },
];

const runArgs = z.object({
  script: z.string().min(1).max(64),
  reason: z.string().max(500).default(""),
});

/** Only exit code 0 counts as passed. A cancelled run is not a test result. */
export function statusOf(result: ProcessResult): RunStatus {
  if (result.outcome === "cancelled") return "cancelled";
  if (result.outcome === "spawn_error") return "error";
  if (result.outcome === "timed_out") return "timed_out";
  if (result.exitCode === 0) return "passed";
  if (result.exitCode === null) return "error";
  return "failed";
}

const STATUS_TEXT: Record<RunStatus, string> = {
  passed: "PASSED",
  failed: "FAILED",
  timed_out: "TIMED OUT",
  cancelled: "CANCELLED by the developer",
  error: "COULD NOT RUN",
};

/** Output for the model: errors are often at the start, the summary at the end. */
export function outputForModel(result: RunResult, maxChars = 8000): string {
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (combined.length <= maxChars) return combined;
  const head = combined.slice(0, Math.floor(maxChars * 0.4));
  const tail = combined.slice(-Math.floor(maxChars * 0.6));
  return `${head}\n…[${combined.length - head.length - tail.length} characters omitted]…\n${tail}`;
}

/** Runs run_script. Never throws; nothing runs without approval. */
export async function runScriptTool(options: {
  /** Local folder path of the workspace, or null if it is not on this machine. */
  cwd: string | null;
  host: RunHost;
  rawArguments: string;
  newId: () => string;
  limits: RunLimits;
  signal?: AbortSignal;
}): Promise<ToolOutcome> {
  const { cwd, host, newId, limits, signal } = options;
  let raw: unknown;
  try {
    raw = JSON.parse(options.rawArguments || "{}");
  } catch {
    return {
      ok: false,
      summary: "run_script (invalid arguments)",
      output: "The tool arguments were not valid JSON.",
    };
  }
  const args = runArgs.safeParse(raw);
  if (!args.success) {
    return {
      ok: false,
      summary: "run_script (invalid arguments)",
      output: 'run_script needs "script" and "reason".',
    };
  }
  if (!cwd) {
    return {
      ok: false,
      summary: "Running scripts is unavailable",
      output: "This workspace is not on the local disk, so Bytewise cannot run scripts here.",
    };
  }

  const resolution = resolveVerificationCommand(cwd, args.data.script);
  if (!resolution.allowed) {
    const available = listVerificationCommands(cwd).map((c) => c.script);
    return {
      ok: false,
      summary: `Run refused: ${args.data.script}`,
      output: `${resolution.reason} Allowed scripts in this project: ${available.length ? available.join(", ") : "none"}.`,
    };
  }

  const { command } = resolution;
  const request: RunRequest = {
    id: newId(),
    script: command.script,
    label: command.label,
    definition: command.definition,
    reason: args.data.reason,
  };
  if ((await host.requestRun(request)) === "skipped") {
    return {
      ok: false,
      summary: `Skipped ${command.label}`,
      output: `The developer chose not to run ${command.label}. Do not claim the change is verified.`,
    };
  }

  host.onRunStarted(request);
  const processResult = await runProcess(command.file, command.args, { cwd, limits, signal });
  const result: RunResult = {
    status: statusOf(processResult),
    exitCode: processResult.exitCode,
    durationMs: processResult.durationMs,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    errorMessage: processResult.errorMessage,
  };
  host.onRunFinished(request, result);

  const seconds = (result.durationMs / 1000).toFixed(1);
  const header = `${command.label} → ${STATUS_TEXT[result.status]} (exit code ${result.exitCode ?? "none"}, ${seconds}s)${result.errorMessage ? ` — ${result.errorMessage}` : ""}`;
  return {
    ok: result.status === "passed",
    summary: `Ran ${command.label}: ${STATUS_TEXT[result.status].toLowerCase()}`,
    output: `${header}\n--- output ---\n${outputForModel(result) || "(no output)"}`,
  };
}
