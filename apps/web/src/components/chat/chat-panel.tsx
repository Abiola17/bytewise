"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, Loader2, RotateCw, Send, User } from "lucide-react";
import type { Message } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoiceButton } from "./voice-button";

export function ChatPanel({
  messages,
  pendingMessage,
  busy,
  error,
  canRetry,
  onSend,
  onRetry,
}: {
  messages: Message[];
  /** Shown while the server processes it; not yet confirmed as stored. */
  pendingMessage: string | null;
  busy: boolean;
  error: string | null;
  canRetry: boolean;
  onSend: (content: string) => Promise<boolean>;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Dictated text is appended for review; the developer still decides to send it.
  const appendTranscript = useCallback((text: string) => {
    setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingMessage, busy]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (content.length < 3 || busy) return;
    if (await onSend(content)) setDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && !pendingMessage && (
          <div className="mx-auto max-w-md space-y-2 py-10 text-center text-sm text-muted-foreground">
            <Bot className="mx-auto size-8" aria-hidden />
            <p>Describe the bug you are seeing, or paste an error message or stack trace.</p>
            <p className="font-mono text-xs">
              e.g. “The login endpoint returns 500 for valid credentials.”
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full",
                m.role === "user" ? "bg-primary/20 text-primary" : "bg-muted",
              )}
              aria-hidden
            >
              {m.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
            </div>
            <div
              className={cn(
                "max-w-[85%] space-y-1 rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "bg-primary/10" : "border bg-card",
              )}
            >
              {m.role === "assistant" && m.diagnosisId && (
                <Badge variant="warning" className="mb-1">
                  AI hypothesis
                </Badge>
              )}
              {/* Rendered as plain text, never as HTML. */}
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
            </div>
          </div>
        ))}

        {pendingMessage && (
          <div className="flex flex-row-reverse gap-3 opacity-70">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
              <User className="size-4" aria-hidden />
            </div>
            <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary/10 px-3 py-2 text-sm">
              {pendingMessage}
            </p>
          </div>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Gathering evidence and asking the model… this can take 10–30 seconds.
          </p>
        )}

        {error && !busy && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <p className="flex items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
            </p>
            {canRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RotateCw aria-hidden /> Retry diagnosis
              </Button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t p-3">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          ref={inputRef}
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
          rows={3}
          disabled={busy}
          placeholder="Describe the problem… (⌘/Ctrl + Enter to send)"
          className="min-h-[72px] flex-1 resize-y rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <VoiceButton disabled={busy} onTranscript={appendTranscript} />
        <Button type="submit" disabled={busy || draft.trim().length < 3} aria-label="Send">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        </Button>
      </form>
    </div>
  );
}
