/** Messages exchanged between the extension host and the chat webview. */

export type ChatEntry =
  | { id: string; role: "user" | "assistant" | "error"; text: string }
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
    };

export type ToWebview =
  | {
      type: "state";
      hasKey: boolean;
      model: string;
      workspaceName: string | null;
      entries: ChatEntry[];
      busy: boolean;
    }
  /** Adds an entry, or replaces the entry with the same id (step progress). */
  | { type: "entry"; entry: ChatEntry }
  | { type: "busy"; busy: boolean; label?: string };

export type FromWebview =
  | { type: "ready" }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "setKey" }
  | { type: "newChat" }
  | { type: "openFile"; path: string; line?: number }
  | { type: "decideEdit"; id: string; decision: "accept" | "reject" }
  | { type: "showDiff"; id: string };

export function isFromWebview(value: unknown): value is FromWebview {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; text?: unknown; path?: unknown; line?: unknown };
  switch (v.type) {
    case "ready":
    case "stop":
    case "setKey":
    case "newChat":
      return true;
    case "send":
      return typeof v.text === "string" && v.text.length <= 20_000;
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
    default:
      return false;
  }
}
