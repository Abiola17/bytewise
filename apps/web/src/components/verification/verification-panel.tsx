"use client";

import { useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Play,
  Search,
  XCircle,
} from "lucide-react";
import type { PatchProposal, VerificationCommand, VerificationRun } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Every status has an icon and a text label, never color alone. */
const STATUS: Record<
  VerificationRun["status"],
  {
    label: string;
    icon: typeof CheckCircle2;
    variant: "success" | "destructive" | "warning" | "outline" | "default";
  }
> = {
  running: { label: "Running", icon: Loader2, variant: "default" },
  passed: { label: "Passed", icon: CheckCircle2, variant: "success" },
  failed: { label: "Failed", icon: XCircle, variant: "destructive" },
  timed_out: { label: "Timed out", icon: Clock, variant: "warning" },
  blocked: { label: "Blocked", icon: Ban, variant: "outline" },
  error: { label: "Could not run", icon: AlertCircle, variant: "warning" },
};

export function RunStatusBadge({ status }: { status: VerificationRun["status"] }) {
  const { label, icon: Icon, variant } = STATUS[status];
  return (
    <Badge variant={variant}>
      <Icon className={cn(status === "running" && "animate-spin")} aria-hidden /> {label}
    </Badge>
  );
}

function formatDuration(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Output({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-80 overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}

export function VerificationPanel({
  commands,
  runs,
  patch,
  starting,
  error,
  onRun,
  onDiagnoseFailure,
}: {
  commands: VerificationCommand[];
  runs: VerificationRun[];
  patch: PatchProposal | undefined;
  starting: boolean;
  error: string | null;
  onRun: (script: string) => void;
  onDiagnoseFailure: (run: VerificationRun) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latest = runs[runs.length - 1];
  const selected = runs.find((r) => r.id === selectedId) ?? latest;
  const running = runs.some((r) => r.status === "running");
  const appliedPatch = patch?.status === "applied" ? patch : undefined;

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {appliedPatch
            ? "A patch is applied. Run the project's tests to verify it."
            : "No patch is applied. Running tests now records a baseline."}
        </p>
        {commands.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            This project&apos;s package.json has no allowed verification scripts (test, test:*,
            typecheck, lint, check).
          </p>
        ) : (
          <ul className="space-y-2">
            {commands.map((c) => (
              <li key={c.script} className="flex items-center gap-3 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm">{c.label}</p>
                  <p
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={c.definition}
                  >
                    {c.definition}
                  </p>
                </div>
                <Button size="sm" disabled={running || starting} onClick={() => onRun(c.script)}>
                  {starting || running ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
                  Run
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Only scripts from package.json run, with a time limit and without the server&apos;s
          credentials. They are not network-isolated.
        </p>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
          </p>
        )}
      </div>

      {!selected ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <FlaskConical className="mx-auto mb-2 size-6" aria-hidden />
          No verification runs yet.
        </div>
      ) : (
        <section aria-label="Verification result" className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={selected.status} />
            <code className="font-mono text-xs">{selected.commandLabel}</code>
            {selected.patchId ? (
              <Badge variant="outline">With patch applied</Badge>
            ) : (
              <Badge variant="outline">Baseline (no patch)</Badge>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Exit code</dt>
              <dd className="font-mono">{selected.exitCode ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-mono">{formatDuration(selected.durationMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="font-mono">{new Date(selected.startedAt).toLocaleTimeString()}</dd>
            </div>
          </dl>
          {selected.status === "running" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Waiting for the process to
              finish…
            </p>
          )}
          {selected.errorMessage && (
            <p className="text-sm text-muted-foreground">{selected.errorMessage}</p>
          )}
          <Output label="Standard output" text={selected.stdout} />
          <Output label="Standard error" text={selected.stderr} />
          {selected.outputTruncated && (
            <p className="text-xs text-muted-foreground">
              Output was long; the middle part was omitted.
            </p>
          )}
          {["failed", "timed_out", "error"].includes(selected.status) &&
            selected.id === latest?.id && (
              <Button size="sm" variant="outline" onClick={() => onDiagnoseFailure(selected)}>
                <Search aria-hidden /> Diagnose this failure
              </Button>
            )}
        </section>
      )}

      {runs.length > 1 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">History</p>
          <ul className="space-y-1">
            {[...runs].reverse().map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  aria-current={run.id === selected?.id ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent",
                    run.id === selected?.id && "bg-accent",
                  )}
                >
                  <RunStatusBadge status={run.status} />
                  <span className="min-w-0 flex-1 truncate font-mono">{run.commandLabel}</span>
                  <span className="text-muted-foreground">
                    {new Date(run.startedAt).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
