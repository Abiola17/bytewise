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

const headerInfo = el("div", { className: "header-info" });
const historyBtn = el("button", { className: "header-btn", text: "History" });
historyBtn.type = "button";
historyBtn.title = "View recent conversations in this workspace";
historyBtn.addEventListener("click", () => vscode.postMessage({ type: "viewHistory" }));

const newChatBtn = el("button", { className: "header-btn", text: "+ New" });
newChatBtn.type = "button";
newChatBtn.title = "Start a new conversation";
newChatBtn.addEventListener("click", () => vscode.postMessage({ type: "newChat" }));

const headerActions = el("div", { className: "header-actions" }, historyBtn, newChatBtn);
const header = el("div", { className: "header" }, headerInfo, headerActions);

const messages = el("div", { className: "messages" });
messages.setAttribute("role", "log");
messages.setAttribute("aria-live", "polite");
// While the agent works: spinner, shimmering label, elapsed time and a sliding bar.
const statusText = el("span", { className: "status-label" });
const statusTime = el("span", { className: "status-time" });
const spinner = el("span", { className: "spinner" });
spinner.setAttribute("aria-hidden", "true");
const progress = el("div", { className: "progress" });
progress.setAttribute("aria-hidden", "true");
const stop = el("button", { className: "secondary stop", text: "Stop" });
stop.type = "button";
const status = el(
  "div",
  { className: "status" },
  progress,
  el("span", { className: "status-main" }, spinner, statusText, statusTime),
  stop,
);
status.setAttribute("role", "status");

const SVG = "http://www.w3.org/2000/svg";

/** A small line icon (paths are fixed strings, never model output). */
function icon(paths: string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(k, v);
  }
  for (const d of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
const ICON = {
  plus: ["M12 5v14", "M5 12h14"],
  mic: [
    "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z",
    "M19 10v2a7 7 0 0 1-14 0v-2",
    "M12 19v3",
  ],
  send: ["M12 19V5", "M5 12l7-7 7 7"],
  stop: ["M7 7h10v10H7z"],
  x: ["M18 6 6 18", "M6 6l12 12"],
};

function iconButton(className: string, paths: string[], label: string): HTMLButtonElement {
  const b = el("button", { className });
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.append(icon(paths));
  return b;
}

const input = el("textarea", { className: "input" });
input.rows = 2;
const PLACEHOLDER = "Ask Bytewise… Type @ to attach a file";
input.placeholder = PLACEHOLDER;
input.setAttribute("aria-label", "Message");

// Images attached to the next message, shown as removable thumbnails.
const tray = el("div", { className: "tray" });
tray.hidden = true;
const imagePicker = el("input");
imagePicker.type = "file";
imagePicker.accept = "image/png,image/jpeg,image/webp,image/gif";
imagePicker.multiple = true;
imagePicker.hidden = true;
imagePicker.setAttribute("aria-label", "Attach image");

const attachBtn = iconButton("tool-btn", ICON.plus, "Attach image");
const micBtn = iconButton(
  "tool-btn mic-btn",
  ICON.mic,
  "Dictate (words appear in the box as you speak)",
);
const WAVE_BARS = 14;
const micWave = el("span", { className: "mic-wave" });
const waveBars = Array.from({ length: WAVE_BARS }, () => el("span", { className: "bar" }));
micWave.append(...waveBars);
micWave.setAttribute("aria-hidden", "true");
const micGroup = el("span", { className: "mic-group" }, micWave, micBtn);
const send = iconButton("send-btn", ICON.send, "Send (Enter)");
send.type = "submit";
const voiceNote = el("span", { className: "voice-note" });
voiceNote.setAttribute("role", "status");

const toolbar = el(
  "div",
  { className: "toolbar" },
  attachBtn,
  imagePicker,
  voiceNote,
  el("span", { className: "spacer" }),
  micGroup,
  send,
);

// @-mention suggestions, shown above the message box.
const suggestions = el("ul", { className: "suggestions" });
suggestions.setAttribute("role", "listbox");
suggestions.setAttribute("aria-label", "Files to attach");
suggestions.hidden = true;
const box = el("div", { className: "box" }, tray, input, toolbar);
const composer = el("form", { className: "composer" }, suggestions, box);

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

const RUN_STATUS: Record<string, string> = {
  pending: "Waiting for your approval",
  skipped: "Skipped — not run",
  running: "⏳ Running…",
  passed: "✓ Passed",
  failed: "✗ Failed",
  timed_out: "⏱ Timed out",
  cancelled: "Stopped",
  error: "⚠ Could not run",
};

/** A script the agent wants to run, then its real result. */
function renderRun(entry: Extract<ChatEntry, { role: "run" }>): HTMLElement {
  const card = el(
    "div",
    { className: `run ${entry.status}` },
    el(
      "div",
      { className: "approval-title" },
      el("span", { text: "Run " }),
      el("code", { text: entry.label }),
    ),
    el("p", { className: "run-definition", text: entry.definition }),
  );
  if (entry.reason) card.append(el("p", { className: "approval-why", text: entry.reason }));

  const facts = [RUN_STATUS[entry.status] ?? entry.status];
  if (entry.durationMs !== undefined) facts.push(`${(entry.durationMs / 1000).toFixed(1)}s`);
  if (entry.exitCode !== undefined && entry.exitCode !== null)
    facts.push(`exit code ${entry.exitCode}`);
  card.append(el("p", { className: "run-status", text: facts.join(" · ") }));
  if (entry.errorMessage)
    card.append(el("p", { className: "approval-status", text: entry.errorMessage }));

  if (entry.status === "pending") {
    const run = el("button", { text: "Run" });
    const skip = el("button", { className: "secondary", text: "Skip" });
    for (const b of [run, skip]) b.type = "button";
    run.addEventListener("click", () => {
      run.disabled = skip.disabled = true;
      vscode.postMessage({ type: "decideRun", id: entry.id, decision: "run" });
    });
    skip.addEventListener("click", () => {
      run.disabled = skip.disabled = true;
      vscode.postMessage({ type: "decideRun", id: entry.id, decision: "skip" });
    });
    card.append(el("div", { className: "approval-actions" }, run, skip));
  }

  if (entry.output !== undefined) {
    const details = el(
      "details",
      {},
      el("summary", { text: "Output" }),
      el("pre", { className: "run-output", text: entry.output || "(no output)" }),
    );
    if (entry.status !== "passed") details.open = true;
    const full = el("button", { className: "link", text: "Full output" });
    full.type = "button";
    full.addEventListener("click", () => vscode.postMessage({ type: "showOutput" }));
    card.append(details, el("div", { className: "approval-actions" }, full));
  }
  return card;
}

function renderEntry(entry: ChatEntry): HTMLElement {
  if (entry.role === "step") return renderStep(entry);
  if (entry.role === "run") return renderRun(entry);
  if (entry.role === "approval") return renderApproval(entry);
  const body = el("div", { className: "body" });
  if (entry.role === "assistant") body.append(renderMarkdown(entry.text));
  else body.textContent = entry.text; // user text and errors are shown verbatim
  if (entry.role === "user" && (entry.spoken || entry.attachments?.length)) {
    const meta = el("div", { className: "user-meta" });
    if (entry.spoken) meta.append(el("span", { className: "chip", text: "🎤 Spoken" }));
    for (const name of entry.attachments ?? [])
      meta.append(el("span", { className: "chip", text: `🖼 ${name}` }));
    body.append(meta);
  }
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

let busySince = 0;
let busyTimer: ReturnType<typeof setInterval> | undefined;

function showElapsed() {
  const s = Math.floor((Date.now() - busySince) / 1000);
  statusTime.textContent = s < 1 ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function setBusy(next: boolean, label = "") {
  if (next && !busy) {
    busySince = Date.now();
    busyTimer = setInterval(showElapsed, 1000);
  } else if (!next) {
    clearInterval(busyTimer);
    busyTimer = undefined;
  }
  showElapsed();
  input.placeholder = next ? "Bytewise is working… press Stop to cancel" : PLACEHOLDER;
  composer.classList.toggle("working", next);
  busy = next;
  send.disabled = next;
  input.disabled = next;
  micBtn.disabled = recState === "transcribing" || (next && recState === "idle");
  attachBtn.disabled = next;
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
      text: "Bytewise reads your files, proposes edits you review as diffs, and asks before running your project's test scripts. Type @ to attach a file, click + to add an image, or click 🎤 to speak — your words are transcribed and sent.",
    }),
  );
}

// ---- Voice -----------------------------------------------------------------
// The panel cannot use the microphone, so the extension records with ffmpeg and
// streams it to Muse Voice Transcribe. Words appear in the box as they are
// recognized; nothing is sent until the developer presses send.

let recState: "idle" | "starting" | "recording" | "transcribing" = "idle";
/** What was in the box before dictation started; speech is added after it. */
let dictationPrefix: string | null = null;

function showDictation(text: string, final: boolean) {
  // Not dictating any more (e.g. the message was already sent): ignore late text.
  if (dictationPrefix === null) return;
  const prefix = dictationPrefix;
  const gap = prefix && text && !/\s$/.test(prefix) ? " " : "";
  input.value = prefix + gap + text;
  input.scrollTop = input.scrollHeight;
  input.setSelectionRange(input.value.length, input.value.length);
  if (final) {
    dictationPrefix = null;
    input.focus();
  }
}

/** Newest loudness enters on the right, so the bars scroll like a waveform. */
const levels: number[] = new Array(WAVE_BARS).fill(0);
function showLevel(level: number) {
  levels.shift();
  levels.push(Math.max(0, Math.min(1, level)));
  waveBars.forEach((bar, i) => (bar.style.height = `${Math.round(15 + levels[i]! * 85)}%`));
}

function showRecording(state: typeof recState, error?: string) {
  recState = state;
  const active = state === "recording" || state === "starting";
  micGroup.classList.toggle("recording", active);
  micGroup.classList.toggle("transcribing", state === "transcribing");
  micBtn.replaceChildren(icon(active ? ICON.stop : ICON.mic));
  const label = active ? "Stop dictation" : "Dictate (words appear in the box as you speak)";
  micBtn.title = label;
  micBtn.setAttribute("aria-label", label);
  micBtn.setAttribute("aria-pressed", String(active));
  if (state !== "recording") {
    levels.fill(0);
    waveBars.forEach((bar) => (bar.style.height = ""));
  }
  micBtn.disabled = state === "transcribing" || (busy && !active);
  voiceNote.textContent =
    error ??
    (state === "starting"
      ? "Starting the microphone…"
      : state === "recording"
        ? "Listening… ■ to finish · Esc to cancel"
        : state === "transcribing"
          ? "Finishing transcript…"
          : "");
  voiceNote.classList.toggle("error", Boolean(error));
  if (error)
    setTimeout(() => voiceNote.textContent === error && (voiceNote.textContent = ""), 6000);
}

micBtn.addEventListener("click", () => {
  if (recState === "recording" || recState === "starting") {
    vscode.postMessage({ type: "stopRecording" });
  } else if (recState === "idle" && !busy) {
    dictationPrefix = input.value;
    showRecording("starting");
    vscode.postMessage({ type: "startRecording" });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (recState === "recording" || recState === "starting")) {
    vscode.postMessage({ type: "cancelRecording" });
  }
});

// ---- Images ----------------------------------------------------------------

interface PendingImage {
  name: string;
  dataBase64: string;
  url: string;
}
let pendingImages: PendingImage[] = [];
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function renderTray() {
  tray.replaceChildren(
    ...pendingImages.map((img, i) => {
      const remove = iconButton("thumb-remove", ICON.x, `Remove ${img.name}`);
      remove.addEventListener("click", () => {
        pendingImages = pendingImages.filter((_, k) => k !== i);
        renderTray();
      });
      const thumb = el("img");
      thumb.src = img.url; // a data: URL of the developer's own file
      thumb.alt = img.name;
      return el("div", { className: "thumb" }, thumb, remove);
    }),
  );
  tray.hidden = pendingImages.length === 0;
}

function addImageFiles(files: Iterable<File>) {
  for (const file of files) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      showRecording(recState, `${file.name} is not a PNG, JPEG, WebP or GIF image.`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showRecording(recState, `${file.name} is larger than 4 MB.`);
      continue;
    }
    if (pendingImages.length >= MAX_IMAGES) {
      showRecording(recState, `You can attach up to ${MAX_IMAGES} images.`);
      break;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      pendingImages.push({
        name: file.name || "pasted-image.png",
        dataBase64: url.split(",")[1] ?? "",
        url,
      });
      renderTray();
    };
    reader.readAsDataURL(file);
  }
}

attachBtn.addEventListener("click", () => imagePicker.click());
imagePicker.addEventListener("change", () => {
  if (imagePicker.files) addImageFiles(imagePicker.files);
  imagePicker.value = "";
});
// Paste a screenshot straight into the box, or drop image files on it.
input.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    e.preventDefault();
    addImageFiles(files);
  }
});
box.addEventListener("dragover", (e) => {
  e.preventDefault();
  box.classList.add("dragging");
});
box.addEventListener("dragleave", () => box.classList.remove("dragging"));
box.addEventListener("drop", (e) => {
  e.preventDefault();
  box.classList.remove("dragging");
  if (e.dataTransfer?.files) addImageFiles(e.dataTransfer.files);
});

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case "state": {
      headerInfo.replaceChildren(
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
    case "recording":
      showRecording(msg.state, msg.error);
      if (msg.state === "recording" && msg.level !== undefined) showLevel(msg.level);
      break;
    case "transcribing":
      if (msg.transcribing) {
        setBusy(true, msg.message ?? "Transcribing voice with Meta…");
      } else {
        setBusy(false);
      }
      break;
    case "liveTranscript":
      showDictation(msg.text, msg.final === true);
      break;
    case "files":
      mentionFiles = msg.files;
      updateSuggestions();
      break;
    case "insertText": {
      const before = input.value && !/\s$/.test(input.value) ? `${input.value} ` : input.value;
      input.value = before + msg.text;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      break;
    }
  }
});

// ---- @-mentions ----------------------------------------------------------

let mentionFiles: string[] | null = null;
let matches: string[] = [];
let active = 0;

/** The "@partial" right before the cursor, if the cursor is inside a mention. */
function currentMention(): { start: number; query: string } | null {
  const upto = input.value.slice(0, input.selectionStart ?? input.value.length);
  const m = /(^|\s)@([\w./-]*)$/.exec(upto);
  return m ? { start: upto.length - m[2]!.length - 1, query: m[2]! } : null;
}

function rank(file: string, query: string): number {
  const f = file.toLowerCase();
  const q = query.toLowerCase();
  const name = f.slice(f.lastIndexOf("/") + 1);
  if (name.startsWith(q)) return 0;
  if (f.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return f.includes(q) ? 3 : -1;
}

function updateSuggestions() {
  const mention = currentMention();
  if (!mention || busy) {
    suggestions.hidden = true;
    return;
  }
  if (mentionFiles === null) {
    vscode.postMessage({ type: "requestFiles" });
    mentionFiles = [];
    return;
  }
  matches = mentionFiles
    .map((f) => ({ f, r: rank(f, mention.query) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.f.length - b.f.length)
    .slice(0, 8)
    .map((x) => x.f);
  active = Math.min(active, Math.max(0, matches.length - 1));
  suggestions.replaceChildren(
    ...(matches.length
      ? matches.map((file, i) => {
          const item = el("li", { className: i === active ? "active" : "", text: file });
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(i === active));
          item.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep focus in the textarea
            pick(file);
          });
          return item;
        })
      : [el("li", { className: "none", text: "No matching files" })]),
  );
  suggestions.hidden = false;
}

function pick(file: string) {
  const mention = currentMention();
  if (!mention) return;
  const cursor = input.selectionStart ?? input.value.length;
  input.value = `${input.value.slice(0, mention.start)}@${file} ${input.value.slice(cursor)}`;
  const pos = mention.start + file.length + 2;
  input.setSelectionRange(pos, pos);
  suggestions.hidden = true;
}

input.addEventListener("input", () => {
  active = 0;
  updateSuggestions();
});
input.addEventListener("blur", () => setTimeout(() => (suggestions.hidden = true), 100));

// ---- Input --------------------------------------------------------------

function submit() {
  const text = input.value.trim();
  if ((!text && pendingImages.length === 0) || busy) return;
  suggestions.hidden = true;
  mentionFiles = null; // refresh the file list next time (files may have been created)
  vscode.postMessage({
    type: "send",
    text,
    ...(pendingImages.length
      ? { images: pendingImages.map(({ name, dataBase64 }) => ({ name, dataBase64 })) }
      : {}),
  });
  // Sending ends a dictation; the extension stops the microphone.
  dictationPrefix = null;
  input.value = "";
  pendingImages = [];
  renderTray();
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});
input.addEventListener("keydown", (e) => {
  if (!suggestions.hidden && matches.length) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
      updateSuggestions();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(matches[active]!);
      return;
    }
  }
  if (e.key === "Escape" && !suggestions.hidden) {
    suggestions.hidden = true;
    return;
  }
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
