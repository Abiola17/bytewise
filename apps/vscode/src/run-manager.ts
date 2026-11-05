import * as vscode from "vscode";
import type { RunHost, RunRequest, RunResult } from "./agent/run-tools";
import type { ChatEntry } from "./protocol";

type RunEntry = Extract<ChatEntry, { role: "run" }>;

/** Output kept on the card; the full output goes to the "Bytewise" output channel. */
const CARD_OUTPUT_CHARS = 4000;

function tail(text: string, max: number) {
  return text.length <= max ? text : `…\n${text.slice(-max)}`;
}

/**
 * Asks before every script run and reports the real result. The process itself
 * is started by the run tool with the restricted runner; this class only
 * handles approval and display.
 */
export class RunManager implements RunHost {
  private readonly pending = new Map<
    string,
    { entry: RunEntry; resolve: (d: "approved" | "skipped") => void }
  >();
  private readonly entries = new Map<string, RunEntry>();
  readonly output = vscode.window.createOutputChannel("Bytewise");

  constructor(private readonly onEntry: (entry: ChatEntry) => void) {}

  private update(entry: RunEntry) {
    this.entries.set(entry.id, entry);
    this.onEntry(entry);
  }

  requestRun(request: RunRequest): Promise<"approved" | "skipped"> {
    const entry: RunEntry = {
      id: request.id,
      role: "run",
      label: request.label,
      definition: request.definition,
      reason: request.reason,
      status: "pending",
    };
    this.update(entry);
    return new Promise((resolve) => this.pending.set(request.id, { entry, resolve }));
  }

  decide(id: string, decision: "run" | "skip") {
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    if (decision === "skip") this.update({ ...item.entry, status: "skipped" });
    item.resolve(decision === "run" ? "approved" : "skipped");
  }

  /** Skips everything still waiting (Stop, New Chat, shutdown). */
  skipAll() {
    for (const id of [...this.pending.keys()]) this.decide(id, "skip");
  }

  onRunStarted(request: RunRequest) {
    const entry = this.entries.get(request.id);
    if (entry) this.update({ ...entry, status: "running" });
    this.output.appendLine(
      `\n▶ ${request.label}   (${request.definition})   ${new Date().toLocaleTimeString()}`,
    );
  }

  onRunFinished(request: RunRequest, result: RunResult) {
    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
    this.output.appendLine(combined || "(no output)");
    this.output.appendLine(
      `■ ${request.label}: ${result.status} (exit code ${result.exitCode ?? "none"}, ${(result.durationMs / 1000).toFixed(1)}s)${result.errorMessage ? ` — ${result.errorMessage}` : ""}`,
    );
    const entry = this.entries.get(request.id);
    if (!entry) return;
    this.update({
      ...entry,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: tail(combined, CARD_OUTPUT_CHARS),
      errorMessage: result.errorMessage ?? undefined,
    });
  }

  showOutput() {
    this.output.show(true);
  }

  dispose() {
    this.skipAll();
    this.output.dispose();
  }
}
