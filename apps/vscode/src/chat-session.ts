import type { ChatEntry } from "./protocol";
import { agentSystemPrompt, runAgentTurn } from "./agent/agent";
import type { EditHost } from "./agent/edit-tools";
import type { WorkspaceFs } from "./agent/workspace-fs";
import { MetaApiError, type ChatMessage, type MetaClient } from "./meta/meta-client";

/** Older turns are dropped first; the system prompt is always sent. */
const MAX_HISTORY_MESSAGES = 60;

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
    ): Promise<void> {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      busy = true;
      controller = new AbortController();
      upsert({ id: deps.newId(), role: "user", text: trimmed }, onEntry);
      const userMessage: ChatMessage = { role: "user", content: trimmed };

      try {
        const fs = deps.workspace();
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
        const turn = await runAgentTurn({
          editHost,
          client: deps.client(),
          fs,
          history: trimHistory([...history, userMessage]),
          systemPrompt: agentSystemPrompt(fs.rootName, deps.editorContext(), Boolean(editHost)),
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
