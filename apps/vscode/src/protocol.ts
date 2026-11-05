/** Messages exchanged between the extension host and the chat webview. */

export type ChatEntry =
  | {
      id: string;
      role: "user" | "assistant" | "error";
      text: string;
      /** Names of images attached to a user message. */
      attachments?: string[];
      /** True when the message was spoken and transcribed. */
      spoken?: boolean;
    }
  | {
      id: string;
      role: "step";
      tool: string;
      status: "running" | "done" | "error";
      summary: string;
      /** Workspace-relative file the step refers to, so the panel can open it. */
      path?: string;
      line?: number;
    }
  | {
      /** A proposed file change waiting for (or past) the developer's decision. */
      id: string;
      role: "approval";
      kind: "edit" | "create";
      path: string;
      explanation: string;
      additions: number;
      deletions: number;
      warning: string | null;
      status: "pending" | "accepted" | "rejected" | "failed";
      reason?: string;
    }
  | {
      /** A script the agent wants to run: waiting for approval, running, or finished. */
      id: string;
      role: "run";
      label: string;
      definition: string;
      reason: string;
      status:
        | "pending"
        | "skipped"
        | "running"
        | "passed"
        | "failed"
        | "timed_out"
        | "cancelled"
        | "error";
      exitCode?: number | null;
      durationMs?: number;
      output?: string;
      errorMessage?: string;
    };

export type ToWebview =
  | {
      type: "state";
      hasKey: boolean;
      model: string;
      workspaceName: string | null;
      entries: ChatEntry[];
      busy: boolean;
      sessionTitle?: string;
    }
  /** Workspace files that can be @-mentioned (already filtered by the path policy). */
  | { type: "files"; files: string[] }
  /** Puts text into the message box (e.g. "Ask About Selection"); never sends it. */
  | { type: "insertText"; text: string }
  /** Adds an entry, or replaces the entry with the same id (step progress). */
  | { type: "entry"; entry: ChatEntry }
  | { type: "busy"; busy: boolean; label?: string }
  | { type: "transcribing"; transcribing: boolean; message?: string }
  /**
   * Dictation so far (finished turns + the turn in progress). The panel shows it
   * after whatever was typed before recording; `final` ends the dictation.
   * Cancelling sends empty final text, which restores the box.
   */
  | { type: "liveTranscript"; text: string; final?: boolean }
  /** Microphone state for the 🎤 button (recording happens in the extension, not the panel). */
  | {
      type: "recording";
      state: "idle" | "starting" | "recording" | "transcribing";
      /** Recent microphone loudness, 0–1, for the waveform. */
      level?: number;
      error?: string;
    };

export type FromWebview =
  | { type: "ready" }
  | { type: "send"; text: string; images?: Array<{ name: string; dataBase64: string }> }
  | { type: "stop" }
  | { type: "setKey" }
  | { type: "newChat" }
  | { type: "openFile"; path: string; line?: number }
  | { type: "decideEdit"; id: string; decision: "accept" | "reject" }
  | { type: "showDiff"; id: string }
  | { type: "decideRun"; id: string; decision: "run" | "skip" }
  | { type: "showOutput" }
  | { type: "requestFiles" }
  | { type: "viewHistory" }
  | { type: "startRecording" }
  | { type: "stopRecording" }
  | { type: "cancelRecording" }
  | { type: "requestVoiceFile" };

export function isFromWebview(value: unknown): value is FromWebview {
  if (!value || typeof value !== "object") return false;
  const v = value as {
    type?: unknown;
    text?: unknown;
    path?: unknown;
    line?: unknown;
    images?: unknown;
  };
  switch (v.type) {
    case "ready":
    case "stop":
    case "setKey":
    case "newChat":
    case "viewHistory":
    case "requestVoiceFile":
    case "startRecording":
    case "stopRecording":
    case "cancelRecording":
      return true;
    case "send":
      return (
        typeof v.text === "string" &&
        v.text.length <= 20_000 &&
        (v.images === undefined ||
          (Array.isArray(v.images) &&
            v.images.length <= 4 &&
            v.images.every(
              (i) =>
                i &&
                typeof (i as { name?: unknown }).name === "string" &&
                typeof (i as { dataBase64?: unknown }).dataBase64 === "string" &&
                (i as { dataBase64: string }).dataBase64.length <= 6_000_000,
            )))
      );
    case "openFile":
      return (
        typeof v.path === "string" &&
        v.path.length <= 1024 &&
        (v.line === undefined || (Number.isInteger(v.line) && (v.line as number) > 0))
      );
    case "decideEdit":
      return (
        typeof (v as { id?: unknown }).id === "string" &&
        ((v as { decision?: unknown }).decision === "accept" ||
          (v as { decision?: unknown }).decision === "reject")
      );
    case "showDiff":
      return typeof (v as { id?: unknown }).id === "string";
    case "decideRun":
      return (
        typeof (v as { id?: unknown }).id === "string" &&
        ((v as { decision?: unknown }).decision === "run" ||
          (v as { decision?: unknown }).decision === "skip")
      );
    case "showOutput":
    case "requestFiles":
      return true;
    default:
      return false;
  }
}
