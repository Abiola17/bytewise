"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, ChevronDown, Loader2, Play, SquareTerminal, X } from "lucide-react";
import type { VerificationCommand, VerificationRun } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { RUN_STATUS, RunStatusBadge, formatDuration } from "./chat-cards";

/** Real output of allowed package.json scripts, styled like a terminal. */
export function TerminalPanel({
  runs,
  selectedId,
  commands,
  otherScripts,
  starting,
  error,
  disabled,
  onSelect,
  onRun,
  onClose,
}: {
  runs: VerificationRun[];
  selectedId: string | null;
  commands: VerificationCommand[];
  /** package.json scripts the execution policy does not allow (dev servers, builds…). */
  otherScripts: string[];
  starting: boolean;
  error: string | null;
  /** True before a chat exists: runs belong to a session. */
  disabled: boolean;
  onSelect: (id: string) => void;
  onRun: (script: string) => void;
  onClose: () => void;
}) {
  const latest = runs[runs.length - 1];
  const run = runs.find((r) => r.id === selectedId) ?? latest;
  const running = runs.some((r) => r.status === "running");
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.id, run?.status, run?.stdout.length]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="flex items-center gap-1.5 border-b border-primary pt-px pb-[7px] text-[11px] font-semibold tracking-wider text-foreground uppercase">
          <SquareTerminal className="size-3.5" aria-hidden /> Terminal
        </span>
        {runs.length > 0 && (
          <label className="relative ml-2 flex items-center">
            <span className="sr-only">Choose a run</span>
            <select
              value={run?.id ?? ""}
              onChange={(e) => onSelect(e.target.value)}
              className="h-6 appearance-none rounded border bg-background/60 pr-6 pl-2 font-mono text-[11px] focus-visible:outline-none"
            >
              {[...runs].reverse().map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.startedAt).toLocaleTimeString()} · {r.commandLabel} · {RUN_STATUS[r.status].label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3 text-muted-foreground" aria-hidden />
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          {commands.map((c) => (
            <button
              key={c.script}
              type="button"
              disabled={disabled || running || starting}
              onClick={() => onRun(c.script)}
              title={disabled ? "Start a chat first" : `${c.label}: ${c.definition}`}
              aria-label={`Run ${c.script}`}
              className="inline-flex h-6 items-center gap-1 rounded border bg-background/40 px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              {starting || running ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Play className="size-3 text-success" aria-hidden />}
              {c.script}
            </button>
          ))}
          <button type="button" onClick={onClose} aria-label="Hide terminal" className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div ref={outRef} className="min-h-0 flex-1 overflow-auto bg-editor px-4 py-3 font-mono text-[12px] leading-relaxed">
        {error && (
          <p role="alert" className="mb-2 flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
        {!run ? (
          <div className="space-y-2 font-sans text-xs leading-relaxed text-muted-foreground">
            <p>
              This terminal runs your project&apos;s <strong className="text-foreground">checks</strong>{" "}
              only: package.json scripts named <code className="font-mono">test</code>,{" "}
              <code className="font-mono">test:*</code>, <code className="font-mono">typecheck</code>,{" "}
              <code className="font-mono">lint</code>, <code className="font-mono">check</code> or{" "}
              <code className="font-mono">build</code>. It is
              not a free shell, so Bytewise (and the AI) can never run arbitrary commands on your
              machine.
            </p>
            {commands.length > 0 ? (
              <p>
                Click{" "}
                {commands.map((c, i) => (
                  <span key={c.script}>
                    {i > 0 && ", "}
                    <code className="font-mono text-foreground">{c.script}</code>
                  </span>
                ))}{" "}
                above to run it. The real output and exit code appear here.
              </p>
            ) : (
              <p>This project has no check scripts. Add a <code className="font-mono">test</code> or <code className="font-mono">lint</code> script to package.json to verify fixes.</p>
            )}
            {otherScripts.length > 0 && (
              <p>
                Not available here:{" "}
                {otherScripts.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ", "}
                    <code className="font-mono">{s}</code>
                  </span>
                ))}{" "}
                (they start servers or deploy). Run those in your own terminal.
              </p>
            )}
            <p>
              Uploaded projects don&apos;t include <code className="font-mono">node_modules</code>. If a
              check fails with <em>Cannot find package</em>, run{" "}
              <code className="font-mono text-foreground">npm install</code> in the project folder
              first.
            </p>
          </div>
        ) : (
          <section aria-label="Verification result">
            <p className="text-muted-foreground">
              <span className="text-success">$</span> {run.commandLabel}
              <span className="ml-3 font-sans text-[11px]">
                {run.patchId ? "With patch applied" : "Baseline (no patch)"}
              </span>
            </p>
            {run.stdout && <pre className="mt-2 whitespace-pre-wrap break-words text-foreground/90">{run.stdout}</pre>}
            {run.stderr && <pre className="mt-2 whitespace-pre-wrap break-words text-destructive/90">{run.stderr}</pre>}
            {run.outputTruncated && <p className="mt-2 text-muted-foreground">… output was long; the middle part was omitted.</p>}
            {run.errorMessage && <p className="mt-2 text-warning">{run.errorMessage}</p>}
            <div className={cn("mt-3 flex flex-wrap items-center gap-3 border-t pt-2 font-sans text-xs text-muted-foreground")}>
              <RunStatusBadge status={run.status} />
              <span>
                exit code <span className="font-mono text-foreground">{run.exitCode ?? "—"}</span>
              </span>
              <span>
                duration <span className="font-mono text-foreground">{formatDuration(run.durationMs)}</span>
              </span>
              {run.status === "running" && <span>Waiting for the process to finish…</span>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
