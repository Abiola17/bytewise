"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bug,
  ImagePlus,
  Loader2,
  Mic,
  Play,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  MAX_MESSAGE_IMAGES,
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_MIME_TYPES,
  type PatchProposal,
  type PostMessageRequest,
  type SessionDetail,
  type VerificationRun,
} from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { messageImageUrl } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useLiveDictation } from "@/hooks/use-live-dictation";
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

export type PendingChatMessage =
  | string
  | {
      content: string;
      images?: Array<{ name?: string; preview: string }>;
    };

export interface AgentChatProps {
  projectName: string;
  detail: SessionDetail | null;
  knownFiles: Set<string>;
  pending: PendingChatMessage | null;
  sending: boolean;
  chatError: string | null;
  onSend: (
    content: string,
    images?: PostMessageRequest["images"],
    previews?: Array<{ name?: string; preview: string }>,
  ) => Promise<boolean>;
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

  // ---- Live dictation: words appear in the box as they are recognized. ----
  // What was typed before the mic started; speech is shown after it.
  const dictationPrefix = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const showDictation = useCallback((text: string, final: boolean) => {
    const prefix = dictationPrefix.current;
    if (prefix === null) return; // already sent or cancelled: ignore late text
    const gap = prefix && text && !/\s$/.test(prefix) ? " " : "";
    setDraft(prefix + gap + text);
    if (final) {
      dictationPrefix.current = null;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, []);
  const dictation = useLiveDictation(showDictation);
  const listening = dictation.status === "starting" || dictation.status === "recording";

  function startDictation() {
    dictationPrefix.current = draftRef.current;
    void dictation.start();
  }
  function cancelDictation() {
    const prefix = dictationPrefix.current;
    dictationPrefix.current = null;
    dictation.cancel();
    if (prefix !== null) setDraft(prefix);
  }

  // ---- Images attached to the next message. ----
  const [images, setImages] = useState<
    Array<{
      name: string;
      mimeType: PostMessageRequest["images"][number]["mimeType"];
      data: string;
      preview: string;
    }>
  >([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function normalizeMimeType(
    type: string,
    name: string,
  ): PostMessageRequest["images"][number]["mimeType"] | null {
    if (type === "image/png") return "image/png";
    if (type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
    if (type === "image/webp") return "image/webp";
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    return null;
  }

  function addImageFiles(files: Iterable<File>) {
    setImageError(null);
    for (const file of files) {
      const mime = normalizeMimeType(file.type, file.name);
      if (!mime) {
        setImageError(`${file.name || "That file"} is not a PNG, JPEG or WebP image.`);
        continue;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setImageError(`${file.name || "That image"} is larger than 4 MB.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        const comma = url.indexOf(",");
        if (comma === -1) return;
        setImages((current) => {
          if (current.length >= MAX_MESSAGE_IMAGES) {
            setImageError(`You can attach up to ${MAX_MESSAGE_IMAGES} images.`);
            return current;
          }
          return [
            ...current,
            {
              name: (file.name || "pasted-image").slice(0, 100),
              mimeType: mime,
              data: url.slice(comma + 1),
              preview: url,
            },
          ];
        });
      };
      reader.readAsDataURL(file);
    }
  }

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

  const canSend = draft.trim().length >= 3 || images.length > 0;

  async function submit() {
    const content = draft.trim();
    if (!canSend || busy) return;
    // Sending ends a dictation in progress; its words are already in the box.
    if (dictation.status !== "idle") {
      dictationPrefix.current = null;
      dictation.cancel();
    }
    const runMatch = content.match(/^\/run(?:\s+(\S+))?$/i);
    if (runMatch) {
      const script = runMatch[1];
      if (script && props.commands.some((c) => c.script === script)) {
        props.onRun(script);
        setDraft("");
      }
      return;
    }
    const attached = images.map(({ name, mimeType, data }) => ({
      fileName: (name || "image").slice(0, 100),
      mimeType,
      data,
    }));
    const attachedPreviews = images.map(({ name, preview }) => ({ name, preview }));

    // Optimistically clear the input field and tray immediately upon sending
    const prevDraft = draft;
    const prevImages = images;
    setDraft("");
    setImages([]);
    setImageError(null);

    const ok = await props.onSend(content, attached, attachedPreviews);
    if (!ok) {
      // Restore input state if sending could not be completed
      setDraft(prevDraft);
      setImages(prevImages);
    }
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
                    <div key={m.id} className="flex flex-col items-end gap-1.5">
                      {m.images.length > 0 && (
                        <div className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
                          {m.images.map((image) => (
                            <a
                              key={image.id}
                              href={messageImageUrl(image.id)}
                              target="_blank"
                              rel="noreferrer"
                              title={image.fileName ?? "Attached image"}
                              className="overflow-hidden rounded-lg border bg-card"
                            >
                              <img
                                src={messageImageUrl(image.id)}
                                alt={image.fileName ?? "Attached image"}
                                className="h-20 max-w-40 object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}
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
              <div className="flex flex-col items-end gap-1.5 opacity-70">
                {typeof pending === "object" && pending.images && pending.images.length > 0 && (
                  <div className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
                    {pending.images.map((image, i) => (
                      <div
                        key={i}
                        title={image.name ?? "Attached image"}
                        className="overflow-hidden rounded-lg border bg-card shadow-sm"
                      >
                        <img
                          src={image.preview}
                          alt={image.name ?? "Attached image"}
                          className="h-20 max-w-40 object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {(typeof pending === "string" ? pending : pending.content) ? (
                  <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-sm whitespace-pre-wrap break-words ring-1 ring-primary/20">
                    {typeof pending === "string" ? pending : pending.content}
                  </div>
                ) : null}
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
        <div
          className={cn(
            "rounded-xl border bg-card/70 shadow-sm transition-colors focus-within:border-primary/50",
            dragging && "border-primary",
          )}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            addImageFiles(e.dataTransfer.files);
          }}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((image, i) => (
                <div key={`${image.name}-${i}`} className="group relative">
                  <img
                    src={image.preview}
                    alt={image.name}
                    title={image.name}
                    className="size-14 rounded-md border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setImages((current) => current.filter((_, j) => j !== i))}
                    aria-label={`Remove ${image.name}`}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            ref={inputRef}
            id="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && listening) {
                e.preventDefault();
                cancelDictation();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (files.length) {
                e.preventDefault();
                addImageFiles(files);
              }
            }}
            rows={2}
            disabled={sending}
            placeholder={
              listening
                ? "Listening… speak and your words appear here"
                : detail
                  ? "Reply, or type /run test"
                  : "Describe a bug or ask about the code…"
            }
            className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none disabled:opacity-60"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={SCREENSHOT_MIME_TYPES.join(",")}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || images.length >= MAX_MESSAGE_IMAGES}
              title="Attach images (or paste / drop them here)"
              aria-label="Attach images"
            >
              <ImagePlus aria-hidden />
            </Button>
            <div
              className={cn(
                "flex items-center rounded-lg transition-colors",
                listening && "bg-accent pl-2",
              )}
            >
              {dictation.status === "recording" && (
                <span aria-hidden className="mr-1.5 flex h-4 items-center gap-[2px]">
                  {dictation.levels.map((level, i) => (
                    <span
                      key={i}
                      className="w-[2px] rounded-full bg-foreground transition-[height] duration-100 ease-linear"
                      style={{ height: `${Math.round(15 + level * 85)}%` }}
                    />
                  ))}
                </span>
              )}
              <Button
                type="button"
                size="icon"
                variant={listening ? "default" : "ghost"}
                className={cn("size-8", !listening && "text-muted-foreground")}
                disabled={sending || dictation.status === "finishing"}
                onClick={() => (listening ? void dictation.stop() : startDictation())}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictation" : "Dictate"}
                title={
                  listening
                    ? "Stop dictation (Esc cancels)"
                    : "Dictate — your words appear in the box as you speak"
                }
              >
                {dictation.status === "finishing" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : listening ? (
                  <Square className="fill-current" aria-hidden />
                ) : (
                  <Mic aria-hidden />
                )}
              </Button>
            </div>
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
              className={cn("size-8 rounded-lg", !canSend && "opacity-40")}
              disabled={busy || !canSend}
              aria-label="Send"
            >
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
            </Button>
          </div>
        </div>
        {dictation.error || imageError ? (
          <p role="alert" className="mt-1.5 px-1 text-[11px] text-destructive">
            {dictation.error ?? imageError}
          </p>
        ) : (
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/70" role="status">
            {dictation.status === "starting"
              ? "Starting the microphone…"
              : dictation.status === "recording"
                ? "Listening… click ■ to finish · Esc to cancel · Enter sends and stops the mic"
                : dictation.status === "finishing"
                  ? "Finishing transcript…"
                  : "Enter to send · Shift+Enter for a new line · Bytewise asks before editing files"}
          </p>
        )}
      </form>
    </div>
  );
}
