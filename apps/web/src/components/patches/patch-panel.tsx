"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  FileDiff,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import type { Diagnosis, PatchProposal } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "./diff-viewer";

const STATUS: Record<
  PatchProposal["status"],
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "outline" }
> = {
  proposed: { label: "Proposed · awaiting your review", variant: "warning" },
  applied: { label: "Applied", variant: "success" },
  rejected: { label: "Rejected", variant: "outline" },
  failed: { label: "Not applied", variant: "destructive" },
  superseded: { label: "Superseded", variant: "outline" },
  reverted: { label: "Reverted", variant: "outline" },
};

export type PatchAction = "propose" | "approve" | "reject" | "revert";

export function PatchPanel({
  diagnosis,
  patch,
  busy,
  error,
  onAction,
}: {
  diagnosis: Diagnosis | undefined;
  patch: PatchProposal | undefined;
  busy: PatchAction | null;
  error: string | null;
  onAction: (action: PatchAction) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const canPropose = diagnosis?.kind === "diagnosis";
  const canProposeAgain =
    patch && ["rejected", "failed", "reverted", "superseded"].includes(patch.status);

  const proposeButton = (label: string) => (
    <Button
      size="sm"
      variant={patch ? "outline" : "default"}
      disabled={!canPropose || busy !== null}
      onClick={() => onAction("propose")}
    >
      {busy === "propose" ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Wand2 aria-hidden />
      )}
      {label}
    </Button>
  );

  const errorBox = error && (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
    </p>
  );

  if (!patch) {
    return (
      <div className="space-y-4 p-4">
        <div className="space-y-2 text-center text-sm text-muted-foreground">
          <FileDiff className="mx-auto size-6" aria-hidden />
          {canPropose ? (
            <p>Ask the model for the smallest code change that addresses the diagnosis.</p>
          ) : (
            <p>A patch can be proposed once the session has a diagnosis.</p>
          )}
        </div>
        <div className="flex justify-center">{proposeButton("Propose a fix")}</div>
        {busy === "propose" && (
          <p className="text-center text-xs text-muted-foreground">
            Generating and validating a patch… this can take 10–30 seconds.
          </p>
        )}
        {errorBox}
        <p className="text-center text-xs text-muted-foreground">
          Proposing a fix never changes files. Nothing is written until you approve.
        </p>
      </div>
    );
  }

  const file = patch.files.find((f) => f.path === selectedPath) ?? patch.files[0]!;
  const status = STATUS[patch.status];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-xs text-muted-foreground">
            {patch.provider} · {patch.model}
          </span>
        </div>
        <p className="text-sm leading-relaxed">{patch.explanation}</p>
        {patch.applicationResult && (
          <p className="text-xs text-muted-foreground">{patch.applicationResult}</p>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {patch.status === "proposed" ? "Files that will be modified" : "Files in this patch"}
          </p>
          <ul className="space-y-1">
            {patch.files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  aria-current={f.path === file.path ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-accent",
                    f.path === file.path && "bg-accent",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{f.path}</span>
                  <span className="text-success">+{f.additions}</span>
                  <span className="text-destructive">−{f.deletions}</span>
                </button>
                {f.path === file.path && f.summary && (
                  <p className="px-2 pt-0.5 text-xs text-muted-foreground">{f.summary}</p>
                )}
              </li>
            ))}
          </ul>
        </div>

        {errorBox}

        {patch.status === "proposed" &&
          (confirming ? (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-start gap-2 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                Apply this patch to {patch.files.length} file
                {patch.files.length === 1 ? "" : "s"}? The server re-checks that each file is
                unchanged, then writes all changes together.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirming(false);
                    onAction("approve");
                  }}
                >
                  <Check aria-hidden /> Confirm and apply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => setConfirming(true)}>
                {busy === "approve" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Check aria-hidden />
                )}
                Apply patch
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => onAction("reject")}
              >
                {busy === "reject" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <X aria-hidden />
                )}
                Reject patch
              </Button>
            </div>
          ))}

        {patch.status === "applied" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => onAction("revert")}
            >
              {busy === "revert" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Undo2 aria-hidden />
              )}
              Revert patch
            </Button>
            <span className="text-xs text-muted-foreground">
              Applied, not yet verified. Run the tests in the Tests tab.
            </span>
          </div>
        )}

        {canProposeAgain && proposeButton("Propose a new fix")}
        {busy === "propose" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <RotateCcw className="size-3" aria-hidden /> Generating a new patch…
          </p>
        )}
      </div>

      <div className="min-h-[320px] flex-1">
        <DiffViewer
          path={file.path}
          original={file.originalContent}
          modified={file.proposedContent}
        />
      </div>
    </div>
  );
}
