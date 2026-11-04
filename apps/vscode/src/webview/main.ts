import type { ChatEntry, FromWebview, ToWebview } from "../protocol";
import { renderMarkdown } from "./markdown";

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
const app = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

// ---- Layout -------------------------------------------------------------

const header = el("div", { className: "header" });
const messages = el("div", { className: "messages" });
messages.setAttribute("role", "log");
messages.setAttribute("aria-live", "polite");
const statusText = el("span");
const stop = el("button", { className: "secondary stop", text: "Stop" });
stop.type = "button";
const status = el("div", { className: "status" }, statusText, stop);
status.setAttribute("role", "status");

const input = el("textarea", { className: "input" });
input.rows = 3;
input.placeholder = "Ask Bytewise about your code… (Enter to send, Shift+Enter for a new line)";
input.setAttribute("aria-label", "Message");
const send = el("button", { className: "send", text: "Send" });
const composer = el("form", { className: "composer" }, input, send);

const setup = el(
  "div",
  { className: "setup" },
  el("p", { className: "setup-title", text: "Connect Bytewise to Meta" }),
  el("p", {
    text: "Bytewise uses a Meta model. Add your Meta API key to start. It is stored in VS Code's encrypted secret storage.",
  }),
);
const setKey = el("button", { className: "primary", text: "Set Meta API key" });
setup.append(setKey);

app.append(header, setup, messages, status, composer);

// ---- Rendering ----------------------------------------------------------

let busy = false;

const STEP_ICON: Record<string, string> = {
  read_file: "📄",
  search_files: "🔍",
  list_files: "📁",
};

function renderStep(entry: Extract<ChatEntry, { role: "step" }>): HTMLElement {
  const icon =
    entry.status === "running"
      ? "⏳"
      : entry.status === "error"
        ? "⚠️"
        : (STEP_ICON[entry.tool] ?? "•");
  const label = el("span", { className: "step-label", text: entry.summary });
  const row = el(
    "div",
    { className: `step ${entry.status}` },
    el("span", { className: "step-icon", text: icon }),
    label,
  );
  row.setAttribute(
    "aria-label",
    `${entry.status === "running" ? "In progress" : entry.status === "error" ? "Problem" : "Done"}: ${entry.summary}`,
  );
  if (entry.path && entry.status !== "running") {
    // Clicking a step opens the file the agent looked at.
    const open = el("button", { className: "link", text: "Open" });
    open.type = "button";
    open.title = `Open ${entry.path}${entry.line ? ` at line ${entry.line}` : ""}`;
    open.addEventListener("click", () =>
      vscode.postMessage({ type: "openFile", path: entry.path!, line: entry.line }),
    );
    row.append(open);
  }
  return row;
}

const APPROVAL_STATUS: Record<string, string> = {
  pending: "Waiting for your review",
  accepted: "✓ Applied",
  rejected: "✗ Rejected — file unchanged",
  failed: "⚠ Not applied",
};

/** A proposed change: what will change, and Accept / Reject while it is pending. */
function renderApproval(entry: Extract<ChatEntry, { role: "approval" }>): HTMLElement {
  const title = el(
    "div",
    { className: "approval-title" },
    el("span", { text: entry.kind === "create" ? "New file " : "Edit " }),
    el("code", { text: entry.path }),
    el("span", { className: "stats", text: ` +${entry.additions} −${entry.deletions}` }),
  );
  const card = el("div", { className: `approval ${entry.status}` }, title);
  if (entry.explanation)
    card.append(el("p", { className: "approval-why", text: entry.explanation }));
  if (entry.warning)
    card.append(el("p", { className: "approval-warning", text: `⚠ ${entry.warning}` }));
  card.append(
    el("p", {
      className: "approval-status",
      text:
        entry.status === "failed" && entry.reason
          ? `⚠ Not applied: ${entry.reason}`
          : APPROVAL_STATUS[entry.status]!,
    }),
  );

  if (entry.status === "pending") {
    const accept = el("button", { text: "Accept" });
    const reject = el("button", { className: "secondary", text: "Reject" });
    const diff = el("button", { className: "link", text: "Show diff" });
    for (const b of [accept, reject, diff]) b.type = "button";
    accept.addEventListener("click", () => {
      accept.disabled = reject.disabled = true;
      vscode.postMessage({ type: "decideEdit", id: entry.id, decision: "accept" });
    });
    reject.addEventListener("click", () => {
      accept.disabled = reject.disabled = true;
      vscode.postMessage({ type: "decideEdit", id: entry.id, decision: "reject" });
    });
    diff.addEventListener("click", () => vscode.postMessage({ type: "showDiff", id: entry.id }));
    card.append(el("div", { className: "approval-actions" }, accept, reject, diff));
  } else if (entry.status === "accepted") {
    const open = el("button", { className: "link", text: "Open file" });
    open.type = "button";
    open.addEventListener("click", () =>
      vscode.postMessage({ type: "openFile", path: entry.path }),
    );
    card.append(el("div", { className: "approval-actions" }, open));
  }
  return card;
}

function renderEntry(entry: ChatEntry): HTMLElement {
  if (entry.role === "step") return renderStep(entry);
  if (entry.role === "approval") return renderApproval(entry);
  const body = el("div", { className: "body" });
  if (entry.role === "assistant") body.append(renderMarkdown(entry.text));
  else body.textContent = entry.text; // user text and errors are shown verbatim
  const who = entry.role === "user" ? "You" : entry.role === "assistant" ? "Bytewise" : "Error";
  return el(
    "div",
    { className: `entry ${entry.role}` },
    el("div", { className: "who", text: who }),
    body,
  );
}

/** Adds an entry, or replaces the one with the same id (a step finishing). */
function upsertEntry(entry: ChatEntry) {
  messages.querySelector(".empty")?.remove();
  const node = renderEntry(entry);
  node.dataset.id = entry.id;
  const existing = messages.querySelector(`[data-id="${CSS.escape(entry.id)}"]`);
  if (existing) existing.replaceWith(node);
  else messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function setBusy(next: boolean, label = "") {
  busy = next;
  send.disabled = next;
  input.disabled = next;
  stop.disabled = false;
  statusText.textContent = label;
  status.classList.toggle("visible", next);
  if (!next) input.focus();
}

function empty(workspaceName: string | null) {
  return el(
    "div",
    { className: "empty" },
    el("p", {
      text: workspaceName
        ? `Ask about the code in ${workspaceName}: describe a bug, paste an error, or ask how something works.`
        : "Open a folder (File → Open Folder) so Bytewise can read your code.",
    }),
    el("p", {
      className: "muted",
      text: "Bytewise reads your files to answer. It can propose edits — you review each one as a diff and accept or reject it. It cannot run commands yet.",
    }),
  );
}

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case "state": {
      header.replaceChildren(
        el("span", { className: "model", text: msg.model }),
        el("span", {
          className: "muted",
          text: msg.workspaceName ? ` · ${msg.workspaceName}` : " · no folder open",
        }),
      );
      setup.hidden = msg.hasKey;
      composer.hidden = !msg.hasKey;
      messages.replaceChildren();
      if (msg.entries.length === 0 && msg.hasKey) messages.append(empty(msg.workspaceName));
      msg.entries.forEach(upsertEntry);
      setBusy(msg.busy, msg.busy ? "Working…" : "");
      break;
    }
    case "entry":
      upsertEntry(msg.entry);
      break;
    case "busy":
      setBusy(msg.busy, msg.label);
      break;
  }
});

// ---- Input --------------------------------------------------------------

function submit() {
  const text = input.value.trim();
  if (!text || busy) return;
  vscode.postMessage({ type: "send", text });
  input.value = "";
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});
setKey.addEventListener("click", () => vscode.postMessage({ type: "setKey" }));
stop.addEventListener("click", () => {
  stop.disabled = true;
  statusText.textContent = "Stopping…";
  vscode.postMessage({ type: "stop" });
});

vscode.postMessage({ type: "ready" });
