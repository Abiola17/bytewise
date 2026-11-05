"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bug,
  ImagePlus,
  Loader2,
  Play,
  RotateCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { PatchProposal, SessionDetail, VerificationRun } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VoiceButton } from "@/components/chat/voice-button";
import { RichText, type OpenFileRef } from "./rich-text";
import {
  DiagnosisCard,
  PatchCard,
  ProposeFixCard,
  RunCard,
  Thinking,
  VerifyCard,
  type PatchAction,
  type StoredEvidence,
} from "./chat-cards";

type TimelineItem =
  | { kind: "message"; at: string; message: SessionDetail["messages"][number] }
  | { kind: "patch"; at: string; patch: PatchProposal }
  | { kind: "run"; at: string; run: VerificationRun };

const SUGGESTIONS = [
  { title: "Find a bug", prompt: "When I …, I expect … but … happens. Find the cause." },
  { title: "Review the code", prompt: "Review the code and point out likely bugs." },
  { title: "Explain a failure", prompt: "Why is the test suite failing?" },
  { title: "Tour the project", prompt: "Explain how this project is structured." },
];

export interface AgentChatProps {
  projectName: string;
  detail: SessionDetail | null;
  knownFiles: Set<string>;
  pending: string | null;
  sending: boolean;
  chatError: string | null;
  onSend: (content: string) => Promise<boolean>;
  onRetry: () => void;
  onOpenFile: OpenFileRef;
  onOpenEvidence: (item: StoredEvidence) => void;
  patchBusy: PatchAction | null;
  /** Error from approve / reject / revert on the latest patch. */
  patchError: string | null;
  /** Error from asking the model for a new patch. */
  proposeError: string | null;
  onPatchAction: (action: PatchAction, patchId?: string) => void;
  onOpenDiff: (patch: PatchProposal, path: string) => void;
  commands: SessionDetail["verificationCommands"];
  runStarting: boolean;
  runError: string | null;
  onRun: (script: string) => void;
  onShowRun: (runId: string) => void;
  onAttachScreenshot: () => void;
  modelLabel: string | null;
}

export function AgentChat(props: AgentChatProps) {
  const { detail, pending, sending, chatError, knownFiles, onOpenFile } = props;
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const focusWith = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }, []);

  // Dictated text is appended for review; the developer still decides to send it.
  const appendTranscript = useCallback((text: string) => {
    setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    inputRef.current?.focus();
  }, []);

  // Grow the textarea with its content, up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!detail) return [];
    const items: TimelineItem[] = [
      ...detail.messages.map((m) => ({ kind: "message" as const, at: m.createdAt, message: m })),
      ...detail.patches.map((p) => ({ kind: "patch" as const, at: p.createdAt, patch: p })),
      ...detail.verifications.map((r) => ({ kind: "run" as const, at: r.startedAt, run: r })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [detail]);

  const diagnosesById = useMemo(
    () => new Map((detail?.diagnoses ?? []).map((d) => [d.id, d])),
    [detail],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [timeline.length, pending, sending, props.patchBusy, detail?.verifications]);

  const latestDiagnosis = detail?.diagnoses[detail.diagnoses.length - 1];
  const latestPatch = detail?.patches[detail.patches.length - 1];
  const latestRun = detail?.verifications[detail.verifications.length - 1];
  const lastMessage = detail?.messages[detail.messages.length - 1];
  const canRetry = lastMessage?.role === "user";
  const busy = sending || props.patchBusy !== null;

  // Offer a fix for the newest diagnosis unless one is already open or applied for it.
  const hasActivePatch = detail?.patches.some(
    (p) =>
      p.diagnosisId === latestDiagnosis?.id && (p.status === "proposed" || p.status === "applied"),
  );
  const showProposeFix =
    !busy &&
    latestDiagnosis?.kind === "diagnosis" &&
    !hasActivePatch &&
    latestPatch?.status !== "proposed";
  const showVerify =
    latestPatch?.status === "applied" &&
    !detail?.verifications.some((r) => r.patchId === latestPatch.id);

  async function submit() {
    const content = draft.trim();
    if (content.length < 3 || busy) return;
    const runMatch = content.match(/^\/run(?:\s+(\S+))?$/i);
    if (runMatch) {
      const script = runMatch[1];
      if (script && props.commands.some((c) => c.script === script)) {
        props.onRun(script);
        setDraft("");
      }
      return;
    }
    if (await props.onSend(content)) setDraft("");
  }

  const empty = timeline.length === 0 && !pending;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {empty ? (
          <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-5 py-8">
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl border bg-card text-primary shadow-[0_0_24px_-6px_var(--primary)]">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
              What should we work on in {props.projectName}?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Describe a bug or ask about the code. Bytewise reads your project, explains what it
              finds and cites the exact lines.
            </p>
            <div className="mt-5 grid min-w-0 gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  type="button"
                  disabled={busy}
                  onClick={() => focusWith(s.prompt)}
                  className="group min-w-0 rounded-lg border bg-card/40 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-card disabled:opacity-50"
                >
                  <span className="block text-sm font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-muted-foreground group-hover:text-foreground/80">
                    {s.prompt}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              It asks before changing any file or running any command, and reports only real test
              results.
            </p>
          </div>
        ) : (
          <div className="space-y-5 px-4 py-5">
            {timeline.map((item) => {
              if (item.kind === "message") {
                const m = item.message;
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-sm whitespace-pre-wrap break-words ring-1 ring-primary/20">
                        {m.content}
                      </div>
                    </div>
                  );
                }
                const diagnosis = m.diagnosisId ? diagnosesById.get(m.diagnosisId) : undefined;
                return (
                  <div key={m.id} className="flex gap-2.5">
                    <div
                      aria-hidden
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-card text-primary"
                    >
                      <Bug className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <RichText text={m.content} knownFiles={knownFiles} onOpenFile={onOpenFile} />
                      {diagnosis && (
                        <DiagnosisCard
                          diagnosis={diagnosis}
                          evidence={detail?.evidence ?? []}
                          onOpenEvidence={props.onOpenEvidence}
                          onAsk={(q) => focusWith(`${q}\n`)}
                        />
                      )}
                    </div>
                  </div>
                );
              }
              if (item.kind === "patch") {
                return (
                  <div key={item.patch.id} className="pl-8">
                    <PatchCard
                      patch={item.patch}
                      isLatest={item.patch.id === latestPatch?.id}
                      busy={props.patchBusy}
                      error={props.patchError}
                      onAction={props.onPatchAction}
                      onOpenDiff={props.onOpenDiff}
                    />
                  </div>
                );
              }
              return (
                <div key={item.run.id} className="pl-8">
                  <RunCard
                    run={item.run}
                    isLatest={item.run.id === latestRun?.id}
                    onShow={props.onShowRun}
                    onDiagnose={(run) => {
                      // The server adds the run's real output as evidence for this request.
                      const outcome = run.status === "timed_out" ? "timed out" : "failed";
                      void props.onSend(
                        `The verification run \`${run.commandLabel}\` ${outcome}. Investigate the output and find the cause.`,
                      );
                    }}
                  />
                </div>
              );
            })}

            {pending && (
              <div className="flex justify-end opacity-70">
                <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-sm whitespace-pre-wrap break-words ring-1 ring-primary/20">
                  {pending}
                </div>
              </div>
            )}

            {sending && (
              <div className="pl-8">
                <Thinking label="Searching the project and asking the model…" />
              </div>
            )}
            {props.patchBusy === "propose" && (
              <div className="pl-8">
                <Thinking label="Writing and validating a patch…" />
              </div>
            )}

            {showProposeFix && (
              <div className="pl-8">
                <ProposeFixCard
                  busy={props.patchBusy !== null}
                  error={props.proposeError}
                  onPropose={() => props.onPatchAction("propose")}
                />
              </div>
            )}
            {showVerify && (
              <div className="pl-8">
                <VerifyCard
                  commands={props.commands}
                  busy={props.runStarting || latestRun?.status === "running"}
                  error={props.runError}
                  onRun={props.onRun}
                />
              </div>
            )}

            {chatError && !sending && (
              <div
                role="alert"
                className="ml-8 space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                <p className="flex items-start gap-2 text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {chatError}
                </p>
                {canRetry && (
                  <Button size="sm" variant="outline" onClick={props.onRetry}>
                    <RotateCw aria-hidden /> Retry diagnosis
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="p-3"
      >
        <div className="rounded-xl border bg-card/70 shadow-sm transition-colors focus-within:border-primary/50">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            ref={inputRef}
            id="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            disabled={sending}
            placeholder={
              detail ? "Reply, or type /run test" : "Describe a bug or ask about the code…"
            }
            className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none disabled:opacity-60"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground"
              onClick={props.onAttachScreenshot}
              disabled={!detail}
              title={detail ? "Add a screenshot of the bug" : "Send a message first to add screenshots"}
              aria-label="Add a screenshot"
            >
              <ImagePlus aria-hidden />
            </Button>
            <VoiceButton compact disabled={sending} onTranscript={appendTranscript} />
            {props.commands.length > 0 && (
              <div className="ml-1 hidden items-center gap-1 sm:flex">
                {props.commands.slice(0, 3).map((c) => (
                  <button
                    key={c.script}
                    type="button"
                    disabled={busy || props.runStarting}
                    onClick={() => props.onRun(c.script)}
                    title={`Run ${c.label}: ${c.definition}`}
                    className="inline-flex h-7 items-center gap-1 rounded-md border bg-background/40 px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                  >
                    <Play className="size-3" aria-hidden />
                    {c.script}
                  </button>
                ))}
              </div>
            )}
            <span className="ml-auto" />
            <span className="hidden truncate pr-1 text-[11px] text-muted-foreground md:inline">
              {props.modelLabel}
            </span>
            <Button
              type="submit"
              size="icon"
              className={cn("size-8 rounded-lg", draft.trim().length < 3 && "opacity-40")}
              disabled={busy || draft.trim().length < 3}
              aria-label="Send"
            >
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
            </Button>
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/70">
          Enter to send · Shift+Enter for a new line · Bytewise asks before editing files
        </p>
      </form>
    </div>
  );
}
