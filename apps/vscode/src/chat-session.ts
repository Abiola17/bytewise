import type { ChatEntry } from "./protocol";
import { agentSystemPrompt, runAgentTurn } from "./agent/agent";
import type { RunLimits } from "@bytewise/execution";
import type { EditHost } from "./agent/edit-tools";
import { dataUrl, type ImageAttachment } from "./agent/images";
import { attachMentions, messageWithAttachments } from "./agent/mentions";
import type { RunHost } from "./agent/run-tools";
import type { WorkspaceFs } from "./agent/workspace-fs";
import { MetaApiError, type ChatMessage, type MetaClient } from "./meta/meta-client";

/** Older turns are dropped first; the system prompt is always sent. */
const MAX_HISTORY_MESSAGES = 60;

/** What is saved between VS Code sessions. */
export interface ChatSnapshot {
  version: 1;
  history: ChatMessage[];
  entries: ChatEntry[];
}

const MAX_SNAPSHOT_ENTRIES = 300;

/**
 * Restored conversations cannot resume work that was in flight: anything that
 * was waiting or running is shown as interrupted, never as still pending.
 */
export function normalizeRestoredEntries(entries: ChatEntry[]): ChatEntry[] {
  return entries.map((e) => {
    if (e.role === "approval" && e.status === "pending") {
      return { ...e, status: "rejected", reason: "VS Code was closed before a decision." };
    }
    if (e.role === "run" && (e.status === "pending" || e.status === "running")) {
      return {
        ...e,
        status: e.status === "pending" ? "skipped" : "cancelled",
        errorMessage: "Interrupted when VS Code was closed.",
      };
    }
    if (e.role === "step" && e.status === "running")
      return { ...e, status: "error", summary: `${e.summary} (interrupted)` };
    return e;
  });
}

/** Replaces image parts with a short note, so saved history never stores image data. */
export function withoutImages(message: ChatMessage): ChatMessage {
  if (!Array.isArray(message.content)) return message;
  const text = message.content
    .map((p) =>
      p.type === "text" ? p.text : "[an image was attached here; it is not kept after a restart]",
    )
    .join("\n");
  return { ...message, content: text };
}

export function chatOnlyPrompt(): string {
  return [
    "You are Bytewise, a careful coding assistant inside VS Code, powered by a Meta model.",
    "No folder is open, so you cannot look at any files. If the developer asks about their code, ask them to open the project folder (File → Open Folder) or paste the code.",
    "Be concise. Use Markdown, with fenced code blocks for code.",
  ].join(" ");
}

/** Keeps whole turns: the kept history always starts at a user message. */
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  let start = history.length - MAX_HISTORY_MESSAGES;
  while (start < history.length && history[start]!.role !== "user") start++;
  return history.slice(start);
}

/** One conversation: model history, entries shown in the panel, and cancellation. */
export function createChatSession(deps: {
  client: () => MetaClient;
  /** The open folder, or null when no folder is open (chat-only). */
  workspace: () => WorkspaceFs | null;
  editorContext: () => string | null;
  newId: () => string;
  /** Approval host for edits; when absent the agent is read-only. */
  editHost?: () => EditHost | null;
  /** Approval host for running scripts; when absent nothing can run. */
  run?: () => { host: RunHost; cwd: string | null; limits: RunLimits } | null;
}) {
  let history: ChatMessage[] = [];
  let entries: ChatEntry[] = [];
  let busy = false;
  let controller: AbortController | null = null;

  const upsert = (entry: ChatEntry, onEntry: (e: ChatEntry) => void) => {
    const i = entries.findIndex((e) => e.id === entry.id);
    entries = i === -1 ? [...entries, entry] : entries.map((e) => (e.id === entry.id ? entry : e));
    onEntry(entry);
  };

  return {
    get entries(): ChatEntry[] {
      return entries;
    },
    get busy() {
      return busy;
    },

    reset() {
      controller?.abort();
      history = [];
      entries = [];
    },

    /** The conversation to save. Only whole turns are kept in history. */
    snapshot(): ChatSnapshot {
      return {
        version: 1,
        // Images are not saved: only their names, so the stored chat stays small.
        history: trimHistory(history).map(withoutImages),
        entries: entries.slice(-MAX_SNAPSHOT_ENTRIES),
      };
    },

    restore(saved: unknown) {
      const snap = saved as Partial<ChatSnapshot> | undefined;
      if (
        !snap ||
        snap.version !== 1 ||
        !Array.isArray(snap.history) ||
        !Array.isArray(snap.entries)
      ) {
        return;
      }
      history = trimHistory(snap.history);
      entries = normalizeRestoredEntries(snap.entries);
    },

    stop() {
      controller?.abort();
    },

    /** Records an entry produced outside a send() call (e.g. an approval card update). */
    record(entry: ChatEntry, onEntry: (e: ChatEntry) => void) {
      upsert(entry, onEntry);
    },

    /**
     * Runs one user turn, reporting entries — the user's message, each tool
     * step as it starts and finishes, then the reply or an error — through
     * `onEntry`. A failed or stopped turn is not kept in model history.
     */
    async send(
      text: string,
      onEntry: (entry: ChatEntry) => void,
      onStatus: (label: string) => void = () => {},
      options: { images?: ImageAttachment[]; spoken?: boolean } = {},
    ): Promise<void> {
      const images = options.images ?? [];
      const trimmed = text.trim() || (images.length ? "Please look at the attached image." : "");
      if (!trimmed || busy) return;
      busy = true;
      controller = new AbortController();
      upsert(
        {
          id: deps.newId(),
          role: "user",
          text: trimmed,
          ...(images.length ? { attachments: images.map((i) => i.name) } : {}),
          ...(options.spoken ? { spoken: true } : {}),
        },
        onEntry,
      );
      let userMessage: ChatMessage = { role: "user", content: trimmed };

      try {
        const fs = deps.workspace();
        if (fs) {
          // @file mentions: attach the files' content to what the model receives.
          const attached = await attachMentions(fs, trimmed);
          for (const { mention, outcome } of attached) {
            upsert(
              {
                id: deps.newId(),
                role: "step",
                tool: "attach",
                status: outcome.ok ? "done" : "error",
                summary: outcome.ok
                  ? outcome.summary.replace(/^Read /, "Attached ")
                  : `Could not attach ${mention.path}: ${outcome.output}`,
                path: outcome.ok ? outcome.path : undefined,
                line: outcome.line,
              },
              onEntry,
            );
          }
          userMessage = { role: "user", content: messageWithAttachments(trimmed, attached) };
        }
        if (images.length) {
          // The model receives the images with the text (verified with muse-spark-1.3).
          userMessage = {
            role: "user",
            content: [
              { type: "text", text: userMessage.content as string },
              ...images.map((image) => ({
                type: "image_url" as const,
                image_url: { url: dataUrl(image) },
              })),
            ],
          };
        }
        if (!fs) {
          onStatus("Thinking…");
          const result = await deps.client().chat({
            messages: [
              { role: "system", content: chatOnlyPrompt() },
              ...trimHistory([...history, userMessage]),
            ],
            reasoningEffort: "low",
            signal: controller.signal,
          });
          const reply = result.content?.trim() || "(The model returned an empty response.)";
          history.push(userMessage, { role: "assistant", content: reply });
          upsert({ id: deps.newId(), role: "assistant", text: reply }, onEntry);
          return;
        }

        const editHost = deps.editHost?.() ?? undefined;
        const run = deps.run?.() ?? undefined;
        const turn = await runAgentTurn({
          editHost,
          run,
          client: deps.client(),
          fs,
          history: trimHistory([...history, userMessage]),
          systemPrompt: agentSystemPrompt(
            fs.rootName,
            deps.editorContext(),
            Boolean(editHost),
            Boolean(run),
          ),
          signal: controller.signal,
          newId: deps.newId,
          callbacks: {
            onStep: (step) => upsert({ ...step, role: "step" }, onEntry),
            onStatus,
          },
        });
        if (turn.stoppedEarly === "cancelled") {
          upsert({ id: deps.newId(), role: "assistant", text: "Stopped." }, onEntry);
          return;
        }
        // Keep the tool exchange in history so follow-up questions have the context.
        history.push(userMessage, ...turn.messages);
        const note =
          turn.stoppedEarly === "limit" ? "\n\n_(Reached the step limit for one request.)_" : "";
        upsert({ id: deps.newId(), role: "assistant", text: turn.reply + note }, onEntry);
      } catch (error) {
        const cancelled = error instanceof MetaApiError && error.kind === "cancelled";
        const message =
          error instanceof MetaApiError
            ? error.message
            : "Something went wrong talking to the model.";
        upsert(
          { id: deps.newId(), role: cancelled ? "assistant" : "error", text: message },
          onEntry,
        );
      } finally {
        busy = false;
        controller = null;
      }
    },
  };
}

export type ChatSession = ReturnType<typeof createChatSession>;
