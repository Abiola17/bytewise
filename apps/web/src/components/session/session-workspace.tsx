"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import type { SessionDetail } from "@bytewise/shared";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChatPanel } from "@/components/chat/chat-panel";
import { DiagnosisPanel } from "@/components/diagnosis/diagnosis-panel";
import { EvidenceCard } from "@/components/evidence/evidence-card";
import { PatchPanel, type PatchAction } from "@/components/patches/patch-panel";
import { VerificationPanel } from "@/components/verification/verification-panel";
import { ScreenshotPanel } from "@/components/screenshots/screenshot-panel";
import { NextStep, type SessionTab } from "@/components/session/next-step";

const STATUS_LABEL: Record<SessionDetail["session"]["status"], string> = {
  open: "Open",
  diagnosed: "Diagnosed",
  needs_information: "Needs information",
  patch_proposed: "Patch proposed",
  patch_applied: "Patch applied",
  fix_verified: "Fix verified",
  verification_failed: "Verification failed",
  closed: "Closed",
};

type Tab = SessionTab;
const TABS: Tab[] = ["diagnosis", "patch", "tests", "evidence"];
const TAB_LABEL: Record<Tab, string> = {
  diagnosis: "Diagnosis",
  patch: "Patch",
  tests: "Tests",
  evidence: "Evidence",
};
const POLL_INTERVAL_MS = 1000;

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("diagnosis");
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  const [patchBusy, setPatchBusy] = useState<PatchAction | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.getSession(sessionId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load session.");
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while a verification run is in progress; stop once it finishes.
  const hasRunningVerification = detail?.verifications.some((v) => v.status === "running") ?? false;
  useEffect(() => {
    if (!hasRunningVerification) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasRunningVerification, refresh]);

  async function startRun(script: string) {
    setStartingRun(true);
    setRunError(null);
    try {
      await api.startVerification(sessionId, script);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Could not start the run.");
    } finally {
      await refresh();
      setStartingRun(false);
    }
  }

  async function run(action: () => Promise<SessionDetail>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setDetail(await action());
      setTab("diagnosis");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
      // Show what the server actually stored (the user message is kept on model failure).
      await refresh();
      return false;
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  /** Runs a patch action, then reloads the session so the UI shows the backend's state. */
  async function patchAction(action: PatchAction, patchId: string | undefined) {
    setPatchBusy(action);
    setPatchError(null);
    try {
      if (action === "propose") await api.proposePatch(sessionId);
      else if (patchId && action === "approve") await api.approvePatch(patchId);
      else if (patchId && action === "reject") await api.rejectPatch(patchId);
      else if (patchId && action === "revert") await api.revertPatch(patchId);
    } catch (e) {
      setPatchError(e instanceof Error ? e.message : "The patch action failed.");
    } finally {
      await refresh();
      setPatchBusy(null);
    }
  }

  function selectEvidence(id: string) {
    setTab("evidence");
    setActiveEvidence(id);
    requestAnimationFrame(() =>
      document.getElementById(`evidence-${id}`)?.scrollIntoView({ behavior: "smooth" }),
    );
  }

  if (loadError && !detail) {
    return (
      <div role="alert" className="space-y-3 p-8 text-sm">
        <p className="flex items-center gap-2 text-destructive">
          <AlertCircle className="size-4" aria-hidden /> {loadError}
        </p>
        <Link href="/sessions" className="text-primary hover:underline">
          Back to sessions
        </Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <p className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading session…
      </p>
    );
  }

  const latest = detail.diagnoses[detail.diagnoses.length - 1];
  const cited = new Set(latest?.evidenceIds ?? []);
  const lastMessage = detail.messages[detail.messages.length - 1];
  const canRetry = lastMessage?.role === "user";
  const latestPatch = detail.patches[detail.patches.length - 1];
  // Cited evidence first, then the rest in retrieval order.
  const evidence = [...detail.evidence].sort(
    (a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)),
  );

  return (
    <div className="flex h-screen flex-col max-lg:h-auto">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <Link
          href={`/projects/${detail.project.id}`}
          aria-label="Back to project"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{detail.session.title}</h1>
        <span className="text-xs text-muted-foreground">{detail.project.name}</span>
        <Badge
          variant={
            detail.session.status === "fix_verified"
              ? "success"
              : detail.session.status === "verification_failed"
                ? "destructive"
                : "outline"
          }
        >
          {STATUS_LABEL[detail.session.status]}
        </Badge>
      </header>
      <NextStep detail={detail} onGoTo={setTab} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(400px,520px)]">
        <section className="flex min-h-[480px] flex-col lg:border-r">
          <ChatPanel
            messages={detail.messages}
            pendingMessage={pending}
            busy={busy}
            error={error}
            canRetry={canRetry}
            onSend={(content) => {
              setPending(content);
              return run(() => api.postMessage(sessionId, content));
            }}
            onRetry={() => void run(() => api.retryDiagnosis(sessionId))}
          />
        </section>

        <aside className="flex min-h-[480px] flex-col border-t lg:border-t-0">
          <div role="tablist" aria-label="Session details" className="flex border-b">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 border-b-2 px-4 py-2 text-sm capitalize",
                  tab === t
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "evidence" ? `Evidence (${detail.evidence.length})` : TAB_LABEL[t]}
              </button>
            ))}
          </div>
          <div
            className={cn(
              "min-h-0 flex-1",
              tab === "patch" ? "flex flex-col overflow-hidden" : "overflow-y-auto",
            )}
          >
            {tab === "diagnosis" ? (
              <DiagnosisPanel
                diagnosis={latest}
                evidence={detail.evidence}
                onSelectEvidence={selectEvidence}
                onProposeFix={() => setTab("patch")}
              />
            ) : tab === "tests" ? (
              <VerificationPanel
                commands={detail.verificationCommands}
                runs={detail.verifications}
                patch={latestPatch}
                starting={startingRun}
                error={runError}
                onRun={(script) => void startRun(script)}
                onDiagnoseFailure={(failed) => {
                  // The server adds the run's real output as evidence for this request.
                  const outcome = failed.status === "timed_out" ? "timed out" : "failed";
                  const message = `The verification run \`${failed.commandLabel}\` ${outcome}. Investigate the output and find the cause.`;
                  setPending(message);
                  void run(() => api.postMessage(sessionId, message));
                }}
              />
            ) : tab === "patch" ? (
              <PatchPanel
                key={latestPatch?.id ?? "none"}
                diagnosis={latest}
                patch={latestPatch}
                busy={patchBusy}
                error={patchError}
                onAction={(action) => void patchAction(action, latestPatch?.id)}
              />
            ) : (
              <div className="space-y-3 p-4">
                <ScreenshotPanel
                  sessionId={sessionId}
                  screenshots={detail.screenshots}
                  onUploaded={refresh}
                />
                <Badge variant="outline">Observed evidence · read from project files</Badge>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No evidence gathered yet.</p>
                ) : (
                  evidence.map((item) => (
                    <EvidenceCard
                      key={item.id}
                      item={item}
                      projectId={detail.project.id}
                      cited={cited.has(item.id)}
                      active={activeEvidence === item.id}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
