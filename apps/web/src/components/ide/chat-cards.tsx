"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileDiff,
  FlaskConical,
  HelpCircle,
  Lightbulb,
  Loader2,
  Play,
  Search,
  ShieldCheck,
  SquareTerminal,
  Undo2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import type {
  Diagnosis,
  PatchProposal,
  SessionDetail,
  VerificationCommand,
  VerificationRun,
} from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type StoredEvidence = SessionDetail["evidence"][number];
export type PatchAction = "propose" | "approve" | "reject" | "revert";

/** Evidence that is a project file (has real line numbers and can be opened). */
export const isFileEvidence = (item: StoredEvidence) =>
  item.sourceType !== "test_output" && item.sourceType !== "screenshot_regions";

export const evidenceLabel = (item: StoredEvidence) =>
  isFileEvidence(item) ? `${item.relativePath}:${item.startLine}–${item.endLine}` : item.relativePath;

/** A bordered card in the chat stream with an icon header. */
function Card({
  icon,
  title,
  aside,
  tone = "default",
  children,
  label,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  aside?: React.ReactNode;
  tone?: "default" | "warning" | "success" | "destructive" | "primary";
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "overflow-hidden rounded-xl border bg-card/60",
        tone === "warning" && "border-warning/35",
        tone === "success" && "border-success/35",
        tone === "destructive" && "border-destructive/35",
        tone === "primary" && "border-primary/40",
      )}
    >
      <header className="flex items-center gap-2 border-b bg-card/80 px-3 py-2 text-xs">
        <span className="flex size-5 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {aside}
      </header>
      <div className="space-y-3 p-3 text-sm">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

const CONFIDENCE_VARIANT = { low: "warning", medium: "default", high: "success" } as const;

export function DiagnosisCard({
  diagnosis,
  evidence,
  onOpenEvidence,
  onAsk,
}: {
  diagnosis: Diagnosis;
  evidence: StoredEvidence[];
  onOpenEvidence: (item: StoredEvidence) => void;
  onAsk: (question: string) => void;
}) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const cited = diagnosis.evidenceIds
    .map((id) => byId.get(id))
    .filter((e): e is StoredEvidence => Boolean(e));

  if (diagnosis.kind === "needs_information") {
    return (
      <Card icon={<HelpCircle />} title="More information needed" tone="primary">
        <p className="leading-relaxed">{diagnosis.summary}</p>
        {diagnosis.clarifyingQuestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Click a question to answer it:</p>
            {diagnosis.clarifyingQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onAsk(q)}
                className="flex w-full items-start gap-2 rounded-lg border bg-background/40 px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                {q}
              </button>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      icon={<Lightbulb />}
      title="Diagnosis"
      tone="warning"
      aside={
        <span className="flex items-center gap-1.5">
          <Badge variant="warning">AI hypothesis · not verified</Badge>
          {diagnosis.confidence && (
            <Badge variant={CONFIDENCE_VARIANT[diagnosis.confidence]}>
              {diagnosis.confidence} confidence
            </Badge>
          )}
        </span>
      }
    >
      <Field label="Summary">{diagnosis.summary}</Field>
      {diagnosis.likelyCause && <Field label="Likely cause">{diagnosis.likelyCause}</Field>}
      {diagnosis.suggestedFix && <Field label="Suggested fix">{diagnosis.suggestedFix}</Field>}
      <Field label="Supporting evidence">
        {cited.length === 0 ? (
          <span className="text-muted-foreground">No retrieved evidence was cited.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {cited.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenEvidence(item)}
                title={item.reason}
                className="rounded-md border bg-background/50 px-2 py-0.5 font-mono text-xs text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                {evidenceLabel(item)}
              </button>
            ))}
          </div>
        )}
      </Field>
      {(diagnosis.uncertainty || diagnosis.limitations.length > 0) && (
        <details className="group rounded-lg border bg-background/30 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronRight
              className="size-3.5 transition-transform group-open:rotate-90"
              aria-hidden
            />
            Uncertainty and limitations
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            {diagnosis.uncertainty && <p>{diagnosis.uncertainty}</p>}
            {diagnosis.limitations.map((l) => (
              <p key={l} className="flex gap-2 text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
                {l}
              </p>
            ))}
          </div>
        </details>
      )}
      <p className="text-[11px] text-muted-foreground">
        {diagnosis.provider} · {diagnosis.model} · no files changed, no tests run
      </p>
    </Card>
  );
}

const PATCH_STATUS: Record<
  PatchProposal["status"],
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "outline" }
> = {
  proposed: { label: "Awaiting your review", variant: "warning" },
  applied: { label: "Applied", variant: "success" },
  rejected: { label: "Rejected", variant: "outline" },
  failed: { label: "Not applied", variant: "destructive" },
  superseded: { label: "Superseded", variant: "outline" },
  reverted: { label: "Reverted", variant: "outline" },
};

export function PatchCard({
  patch,
  isLatest,
  busy,
  error,
  onAction,
  onOpenDiff,
}: {
  patch: PatchProposal;
  isLatest: boolean;
  busy: PatchAction | null;
  error: string | null;
  onAction: (action: PatchAction, patchId: string) => void;
  onOpenDiff: (patch: PatchProposal, path: string) => void;
}) {
  const status = PATCH_STATUS[patch.status];
  const additions = patch.files.reduce((n, f) => n + f.additions, 0);
  const deletions = patch.files.reduce((n, f) => n + f.deletions, 0);
  const awaiting = patch.status === "proposed";

  return (
    <Card
      label="Proposed change"
      icon={<FileDiff />}
      title={
        <>
          Proposed change{" "}
          <span className="font-mono text-success">+{additions}</span>{" "}
          <span className="font-mono text-destructive">−{deletions}</span>
        </>
      }
      tone={awaiting ? "primary" : patch.status === "applied" ? "success" : "default"}
      aside={<Badge variant={status.variant}>{status.label}</Badge>}
    >
      <p className="leading-relaxed">{patch.explanation}</p>
      <ul className="divide-y overflow-hidden rounded-lg border bg-background/40">
        {patch.files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onOpenDiff(patch, f.path)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
              title="Open the diff in the editor"
            >
              <FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">{f.path}</span>
                {f.summary && (
                  <span className="block truncate text-xs text-muted-foreground">{f.summary}</span>
                )}
              </span>
              <span className="font-mono text-xs text-success">+{f.additions}</span>
              <span className="font-mono text-xs text-destructive">−{f.deletions}</span>
            </button>
          </li>
        ))}
      </ul>

      {patch.applicationResult && (
        <p
          className={cn(
            "text-xs",
            patch.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {patch.applicationResult}
        </p>
      )}
      {isLatest && error && (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {awaiting && (
        <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              Bytewise wants to edit{" "}
              <strong>
                {patch.files.length} file{patch.files.length === 1 ? "" : "s"}
              </strong>
              . Nothing is written until you accept. The server re-checks each file is unchanged,
              then writes all changes together.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => onAction("approve", patch.id)}>
              {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Accept and apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => onAction("reject", patch.id)}
            >
              {busy === "reject" ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenDiff(patch, patch.files[0]!.path)}
            >
              <FileDiff aria-hidden /> Review diff
            </Button>
          </div>
        </div>
      )}

      {patch.status === "applied" && isLatest && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => onAction("revert", patch.id)}
        >
          {busy === "revert" ? <Loader2 className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />}
          Revert patch
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        {patch.provider} · {patch.model}
      </p>
    </Card>
  );
}

/** Every status has an icon and a text label, never color alone. */
export const RUN_STATUS: Record<
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
  const { label, icon: Icon, variant } = RUN_STATUS[status];
  return (
    <Badge variant={variant}>
      <Icon className={cn(status === "running" && "animate-spin")} aria-hidden /> {label}
    </Badge>
  );
}

export const formatDuration = (ms: number | null) =>
  ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/** The last lines of a run's output, for a compact preview in the chat. */
function tail(run: VerificationRun, lines = 8) {
  const text = [run.stdout, run.stderr].filter(Boolean).join("\n").trimEnd();
  const all = text.split("\n");
  return all.length > lines ? all.slice(-lines).join("\n") : text;
}

export function RunCard({
  run,
  isLatest,
  onShow,
  onDiagnose,
}: {
  run: VerificationRun;
  isLatest: boolean;
  onShow: (runId: string) => void;
  onDiagnose: (run: VerificationRun) => void;
}) {
  const output = tail(run);
  const failed = ["failed", "timed_out", "error"].includes(run.status);
  return (
    <Card
      icon={<SquareTerminal />}
      title={
        <>
          Ran <code className="font-mono">{run.commandLabel}</code>
        </>
      }
      tone={run.status === "passed" ? "success" : failed ? "destructive" : "default"}
      aside={<RunStatusBadge status={run.status} />}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{run.patchId ? "With patch applied" : "Baseline (no patch)"}</span>
        <span>
          Exit code <span className="font-mono text-foreground">{run.exitCode ?? "—"}</span>
        </span>
        <span>
          Duration <span className="font-mono text-foreground">{formatDuration(run.durationMs)}</span>
        </span>
      </div>
      {run.status === "running" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Waiting for the process to
          finish…
        </p>
      ) : (
        <>
          {run.errorMessage && <p className="text-xs text-muted-foreground">{run.errorMessage}</p>}
          {output && (
            <pre className="max-h-40 overflow-auto rounded-lg border bg-editor p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
              {output}
            </pre>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => onShow(run.id)}>
          <SquareTerminal aria-hidden /> Full output
        </Button>
        {failed && isLatest && (
          <Button size="sm" variant="outline" onClick={() => onDiagnose(run)}>
            <Search aria-hidden /> Diagnose this failure
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Suggests the next step after a diagnosis: asking for a patch. */
export function ProposeFixCard({
  busy,
  error,
  onPropose,
}: {
  busy: boolean;
  error: string | null;
  onPropose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-3 py-2.5">
      <Wand2 className="size-4 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Want a fix? Bytewise will write the smallest change for this diagnosis. You review it before
        anything is written.
      </p>
      <Button size="sm" disabled={busy} onClick={onPropose}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
        Propose a fix
      </Button>
      {error && (
        <p role="alert" className="flex w-full items-start gap-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

/** After a patch is applied: ask permission to run an allowed script. */
export function VerifyCard({
  commands,
  busy,
  error,
  onRun,
}: {
  commands: VerificationCommand[];
  busy: boolean;
  error: string | null;
  onRun: (script: string) => void;
}) {
  return (
    <Card icon={<FlaskConical />} title="Verify the fix" tone="primary">
      <p className="text-xs leading-relaxed text-muted-foreground">
        The patch is applied but not verified. Run one of the project&apos;s scripts to check it.
        Only package.json scripts named test, test:*, typecheck, lint, check or build can run.
      </p>
      {commands.length === 0 ? (
        <p className="text-xs text-muted-foreground">This project has no allowed scripts.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {commands.map((c) => (
            <Button
              key={c.script}
              size="sm"
              variant={c.script === "test" ? "default" : "outline"}
              disabled={busy}
              title={c.definition}
              onClick={() => onRun(c.script)}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
              Run {c.label}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </Card>
  );
}

/** Honest progress: what is happening and for how long, with no invented steps. */
export function Thinking({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted-foreground" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bytewise-dot size-1.5 rounded-full bg-primary"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span>{label}</span>
      <span className="font-mono text-xs tabular-nums">{seconds}s</span>
    </div>
  );
}
