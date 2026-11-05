import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { checkRelativePath } from "@bytewise/shared";
import { normalizeToolPath } from "./agent/tools";
import { createVscodeWorkspaceFs } from "./agent/vscode-workspace-fs";
import { createChatSession, type ChatSession } from "./chat-session";
import { EditManager } from "./edit-manager";
import { RunManager } from "./run-manager";
import { createMetaClient } from "./meta/meta-client";
import { createMetaTranscriptionClient } from "./meta/meta-transcription";
import { createLiveTranscription, type LiveTranscription } from "./meta/live-transcription";
import { wavTo24kPcm16 } from "./audio/wav";
import {
  findFfmpeg,
  pcmLevel,
  startRecording,
  RECORDING_LIMITS,
  type Recording,
} from "./audio/recorder";
import { validateImages, type ImageAttachment } from "./agent/images";
import {
  deriveSessionTitle,
  formatRelativeTime,
  upsertStoredSession,
  type StoredSession,
} from "./session-history";
import { isFromWebview, type ToWebview } from "./protocol";

export const SECRET_KEY = "bytewise.metaApiKey";
const CHAT_STATE_KEY = "bytewise.chat.v1";
const SESSIONS_HISTORY_KEY = "bytewise.sessions.v1";
const ACTIVE_SESSION_ID_KEY = "bytewise.activeSessionId.v1";
const MAX_MENTIONABLE_FILES = 3000;

/** Folders never offered for @-mentions (the same ones the agent cannot read). */
const MENTION_EXCLUDE =
  "**/{node_modules,.git,.hg,.svn,dist,build,out,coverage,.next,.nuxt,.turbo,.cache,.vercel,.idea,.vscode,.data}/**";

/** Files that can be @-mentioned: everything the agent is allowed to read. */
export async function listMentionableFiles(): Promise<string[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return [];
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*"),
    MENTION_EXCLUDE,
    MAX_MENTIONABLE_FILES,
  );
  // File search follows symlinks; never offer a file reached through a linked folder.
  const realDir = new Map<string, Promise<boolean>>();
  const isRealDir = (dir: string): Promise<boolean> => {
    let known = realDir.get(dir);
    if (!known) {
      known = Promise.resolve(
        vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...dir.split("/"))),
      ).then(
        (s) => s.type === vscode.FileType.Directory,
        () => false,
      );
      realDir.set(dir, known);
    }
    return known;
  };
  const allowed: string[] = [];
  for (const rel of uris.map((u) => vscode.workspace.asRelativePath(u, false))) {
    if (!checkRelativePath(rel).allowed) continue;
    const parts = rel.split("/");
    let real = true;
    for (let i = 1; i < parts.length && real; i++)
      real = await isRealDir(parts.slice(0, i).join("/"));
    if (real) allowed.push(rel);
  }
  return allowed.sort();
}

/** The open file and selection, as context for the agent (paths only, no content). */
function editorContext(): string | null {
  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!editor || !folder) return null;
  const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
  if (rel === editor.document.uri.fsPath || !checkRelativePath(rel).allowed) return null;
  const sel = editor.selection;
  const where = sel.isEmpty
    ? `cursor at line ${sel.active.line + 1}`
    : `lines ${sel.start.line + 1}–${sel.end.line + 1} selected`;
  return `the developer has ${rel} open (${where}).`;
}

/** Opens a file the agent referred to. The path comes from the webview, so it is re-validated. */
async function openWorkspaceFile(input: string, line?: number) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const target = normalizeToolPath(input);
  if (!folder || "error" in target || !checkRelativePath(target.path).allowed) return;
  const uri = vscode.Uri.joinPath(folder.uri, ...target.path.split("/"));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const position = new vscode.Position(Math.max(0, (line ?? 1) - 1), 0);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      selection: new vscode.Range(position, position),
    });
  } catch {
    void vscode.window.showWarningMessage(`Bytewise: could not open ${target.path}.`);
  }
}

/** The right-side secondary sidebar chat panel. The API key never leaves the extension host. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "bytewise.chat";
  private view: vscode.WebviewView | undefined;
  /** True once the panel's script has loaded and reported in (used by the smoke test). */
  webviewReady = false;
  private apiKey: string | undefined;
  private readonly session: ChatSession;
  readonly edits: EditManager;
  readonly runs: RunManager;
  private currentSessionId: string;
  private sessionCreatedAt: number;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.currentSessionId =
      this.context.workspaceState.get<string>(ACTIVE_SESSION_ID_KEY) ?? randomUUID();
    this.sessionCreatedAt = Date.now();
    this.edits = new EditManager(
      () => vscode.workspace.workspaceFolders?.[0],
      (entry) => this.session.record(entry, (e) => this.post({ type: "entry", entry: e })),
    );
    this.runs = new RunManager((entry) =>
      this.session.record(entry, (e) => this.post({ type: "entry", entry: e })),
    );
    this.session = createChatSession({
      client: () => {
        const config = vscode.workspace.getConfiguration("bytewise");
        return createMetaClient({
          apiKey: this.apiKey,
          baseUrl: config.get<string>("baseUrl", "https://api.meta.ai/v1"),
          model: config.get<string>("model", "muse-spark-1.3"),
          timeoutMs: config.get<number>("requestTimeoutSeconds", 120) * 1000,
        });
      },
      workspace: () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? createVscodeWorkspaceFs(folder) : null;
      },
      editorContext: () => editorContext(),
      newId: () => randomUUID(),
      editHost: () => (vscode.workspace.workspaceFolders?.[0] ? this.edits : null),
      run: () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return null;
        const seconds = vscode.workspace
          .getConfiguration("bytewise")
          .get<number>("commandTimeoutSeconds", 120);
        return {
          host: this.runs,
          // Scripts run on this machine only; remote or virtual folders cannot.
          cwd: folder.uri.scheme === "file" ? folder.uri.fsPath : null,
          limits: { timeoutMs: seconds * 1000, maxOutputChars: 64_000, killGraceMs: 2000 },
        };
      },
    });
    // Each workspace keeps its own conversation across VS Code restarts.
    this.session.restore(this.context.workspaceState.get(CHAT_STATE_KEY));
  }

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Saves current session to recent sessions history. */
  private saveCurrentSessionToHistory() {
    if (this.session.entries.length === 0) return;
    const title = deriveSessionTitle(this.session.entries);
    const existing = this.context.workspaceState.get<StoredSession[]>(SESSIONS_HISTORY_KEY) ?? [];
    const stored: StoredSession = {
      id: this.currentSessionId,
      title,
      createdAt: this.sessionCreatedAt,
      updatedAt: Date.now(),
      entryCount: this.session.entries.length,
      snapshot: this.session.snapshot(),
    };
    const updated = upsertStoredSession(existing, stored);
    void this.context.workspaceState.update(SESSIONS_HISTORY_KEY, updated);
  }

  /** Saves the conversation shortly after it changes. */
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.context.workspaceState.update(CHAT_STATE_KEY, this.session.snapshot());
      void this.context.workspaceState.update(ACTIVE_SESSION_ID_KEY, this.currentSessionId);
      this.saveCurrentSessionToHistory();
    }, 500);
  }

  /** Last text put into the message box (checked by the smoke test). */
  lastInsertedText: string | null = null;

  /** Puts text into the message box and shows the chat. */
  async insertText(text: string) {
    this.lastInsertedText = text;
    await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    this.post({ type: "insertText", text });
  }

  async loadKey() {
    this.apiKey = await this.context.secrets.get(SECRET_KEY);
    this.postState();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const { extensionUri } = this.context;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "dist"),
        vscode.Uri.joinPath(extensionUri, "media"),
      ],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!isFromWebview(raw)) return; // ignore anything malformed
      switch (raw.type) {
        case "ready":
          this.webviewReady = true;
          this.postState();
          break;
        case "setKey":
          await vscode.commands.executeCommand("bytewise.setApiKey");
          break;
        case "newChat":
          this.newChat();
          break;
        case "send": {
          // Sending ends a dictation in progress; the box already holds its text.
          if (this.recording || this.live) this.cancelVoice();
          let images: ImageAttachment[] = [];
          if (raw.images?.length) {
            const check = validateImages(raw.images);
            if (!check.ok) {
              void vscode.window.showErrorMessage(`Bytewise: ${check.error}`);
              break;
            }
            images = check.images;
          }
          await this.sendToAgent(raw.text, { images });
          break;
        }
        case "startRecording":
          await this.startVoice();
          break;
        case "stopRecording":
          await this.stopVoice();
          break;
        case "cancelRecording":
          this.cancelVoice();
          break;
        case "stop":
          // Pending reviews are rejected so the agent loop can finish.
          this.edits.rejectAll("The developer pressed Stop.");
          this.runs.skipAll();
          this.session.stop();
          break;
        case "decideEdit":
          await this.edits.decide(raw.id, raw.decision);
          break;
        case "showDiff":
          await this.edits.showDiff(raw.id);
          break;
        case "decideRun":
          this.runs.decide(raw.id, raw.decision);
          break;
        case "showOutput":
          this.runs.showOutput();
          break;
        case "requestFiles":
          this.post({ type: "files", files: await listMentionableFiles() });
          break;
        case "openFile":
          await openWorkspaceFile(raw.path, raw.line);
          break;
        case "viewHistory":
          await this.viewHistory();
          break;
        case "requestVoiceFile":
          await this.transcribeAudioFile();
          break;
      }
    });
  }

  newChat() {
    this.saveCurrentSessionToHistory();
    this.edits.rejectAll("A new chat was started.");
    this.runs.skipAll();
    this.session.reset();
    this.currentSessionId = randomUUID();
    this.sessionCreatedAt = Date.now();
    void this.context.workspaceState.update(CHAT_STATE_KEY, this.session.snapshot());
    void this.context.workspaceState.update(ACTIVE_SESSION_ID_KEY, this.currentSessionId);
    this.postState();
  }

  switchSession(stored: StoredSession) {
    this.saveCurrentSessionToHistory();
    this.edits.rejectAll("Switched to another conversation.");
    this.runs.skipAll();
    this.session.reset();
    this.session.restore(stored.snapshot);
    this.currentSessionId = stored.id;
    this.sessionCreatedAt = stored.createdAt;
    void this.context.workspaceState.update(CHAT_STATE_KEY, this.session.snapshot());
    void this.context.workspaceState.update(ACTIVE_SESSION_ID_KEY, this.currentSessionId);
    this.postState();
  }

  async viewHistory() {
    const list = this.context.workspaceState.get<StoredSession[]>(SESSIONS_HISTORY_KEY) ?? [];
    if (list.length === 0) {
      void vscode.window.showInformationMessage(
        "Bytewise: No previous conversations in this workspace.",
      );
      return;
    }

    interface SessionItem extends vscode.QuickPickItem {
      session?: StoredSession;
      action?: "clear";
    }

    const items: SessionItem[] = list.map((s) => ({
      label: s.title,
      description: `${formatRelativeTime(s.updatedAt)} · ${s.entryCount} entries`,
      detail: s.id === this.currentSessionId ? "$(check) Currently active" : undefined,
      session: s,
    }));

    items.push(
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(trash) Clear All Conversation History", action: "clear" },
    );

    const picked = await vscode.window.showQuickPick(items, {
      title: "Bytewise: Conversation History",
      placeHolder: "Select a conversation to resume",
    });

    if (!picked) return;
    if (picked.action === "clear") {
      const confirm = await vscode.window.showWarningMessage(
        "Are you sure you want to clear all conversation history for this workspace?",
        { modal: true },
        "Clear History",
      );
      if (confirm === "Clear History") {
        await this.context.workspaceState.update(SESSIONS_HISTORY_KEY, []);
        void vscode.window.showInformationMessage("Bytewise: Conversation history cleared.");
      }
      return;
    }
    if (picked.session && picked.session.id !== this.currentSessionId) {
      this.switchSession(picked.session);
    }
  }

  /** Runs one agent turn for a message typed, spoken or sent with images. */
  private async sendToAgent(
    text: string,
    options: { images?: ImageAttachment[]; spoken?: boolean } = {},
  ) {
    this.post({ type: "busy", busy: true, label: "Thinking…" });
    await this.session.send(
      text,
      (entry) => this.post({ type: "entry", entry }),
      (label) => this.post({ type: "busy", busy: true, label }),
      options,
    );
    this.post({ type: "busy", busy: false });
  }

  // ---- Voice: recorded by the extension (webviews cannot use the microphone) ----

  private recording: Recording | null = null;
  private live: LiveTranscription | null = null;
  private liveError: string | undefined;
  private micLevel = 0;
  private recordingTimer: ReturnType<typeof setInterval> | undefined;

  private postRecording(
    state: "idle" | "starting" | "recording" | "transcribing",
    extra: { level?: number; error?: string } = {},
  ) {
    this.post({ type: "recording", state, ...extra });
  }

  async startVoice() {
    if (this.recording) return;
    if (!this.apiKey) {
      this.postRecording("idle", { error: "Set your Meta API key first." });
      return;
    }
    const config = vscode.workspace.getConfiguration("bytewise");
    const ffmpeg = findFfmpeg(config.get<string>("ffmpegPath"));
    if (!ffmpeg) {
      this.postRecording("idle", { error: "Voice recording needs ffmpeg." });
      const choice = await vscode.window.showWarningMessage(
        "Bytewise records your voice with ffmpeg, which was not found. Install it (macOS: brew install ffmpeg) or set “bytewise.ffmpegPath”. You can also transcribe an audio file.",
        "Transcribe Audio File…",
      );
      if (choice) await this.transcribeAudioFile();
      return;
    }
    this.postRecording("starting");
    // Words stream into the message box while the developer speaks.
    const live = createLiveTranscription({
      apiKey: this.apiKey,
      onText: (text) => this.live === live && this.post({ type: "liveTranscript", text }),
      onError: (error) => {
        if (this.live !== live) return;
        this.liveError = `Live transcript unavailable (${error.message}) — it will be transcribed when you stop.`;
        this.postRecording("recording", { error: this.liveError });
      },
    });
    this.live = live;
    this.liveError = undefined;
    try {
      this.recording = await startRecording({
        ffmpeg,
        microphone: config.get<string>("microphone") || undefined,
        maxSeconds: RECORDING_LIMITS.maxSeconds,
        onLimit: () => void this.stopVoice(),
        onData: (chunk) => {
          live.push(chunk);
          this.micLevel = Math.max(this.micLevel, pcmLevel(chunk));
        },
      });
    } catch (error) {
      live.cancel();
      this.live = null;
      this.recording = null;
      this.postRecording("idle", {
        error: error instanceof Error ? error.message : "Could not start recording.",
      });
      return;
    }
    this.micLevel = 0;
    this.postRecording("recording", { level: 0 });
    // The panel draws a waveform from the loudest audio of each tick.
    this.recordingTimer = setInterval(() => {
      this.postRecording("recording", { level: this.micLevel, error: this.liveError });
      this.micLevel = 0;
    }, 100);
  }

  /**
   * Stops recording and leaves the transcript in the message box for the developer
   * to edit and send. If the live stream failed, the recording is transcribed once.
   */
  async stopVoice() {
    const recording = this.recording;
    const live = this.live;
    if (!recording) return;
    this.recording = null;
    clearInterval(this.recordingTimer);
    this.postRecording("transcribing");
    let pcm: Uint8Array;
    try {
      pcm = await recording.stop();
    } catch {
      live?.cancel();
      this.live = null;
      this.post({ type: "liveTranscript", text: "", final: true });
      this.postRecording("idle", { error: "Recording failed." });
      return;
    }
    let text = "";
    try {
      text = live ? await live.finish() : "";
    } catch {
      // The live stream failed: transcribe the whole recording once instead.
      if (pcm.length >= 24_000) {
        try {
          text = (
            await createMetaTranscriptionClient({
              apiKey: this.apiKey,
              timeoutMs: 30_000,
            }).transcribe(pcm)
          ).text;
        } catch (fallbackError) {
          this.live = null;
          this.post({ type: "liveTranscript", text: "", final: true });
          this.postRecording("idle", {
            error: fallbackError instanceof Error ? fallbackError.message : "Transcription failed.",
          });
          return;
        }
      }
    } finally {
      if (this.live === live) this.live = null;
    }
    this.post({ type: "liveTranscript", text: text.trim(), final: true });
    this.postRecording(
      "idle",
      text.trim() ? {} : { error: "No speech was recognized. Try again closer to the microphone." },
    );
  }

  cancelVoice() {
    const wasActive = Boolean(this.recording || this.live);
    this.recording?.cancel();
    this.recording = null;
    this.live?.cancel();
    this.live = null;
    if (wasActive) this.post({ type: "liveTranscript", text: "", final: true });
    clearInterval(this.recordingTimer);
    this.postRecording("idle");
  }

  async transcribeAudio(pcm: Uint8Array): Promise<string | null> {
    if (!this.apiKey) {
      void vscode.window.showWarningMessage(
        "Bytewise: Please set your Meta API key first to transcribe audio.",
      );
      return null;
    }
    this.post({ type: "transcribing", transcribing: true });
    try {
      const client = createMetaTranscriptionClient({
        apiKey: this.apiKey,
        timeoutMs: 30_000,
      });
      const result = await client.transcribe(pcm);
      if (!result.text) {
        void vscode.window.showInformationMessage(
          "Bytewise: No speech was recognized in the audio.",
        );
        return null;
      }
      await this.insertText(result.text);
      void vscode.window.showInformationMessage(
        "Bytewise: Voice transcript inserted into chat message box.",
      );
      return result.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Bytewise voice transcription failed: ${msg}`);
      return null;
    } finally {
      this.post({ type: "transcribing", transcribing: false });
    }
  }

  async transcribeAudioFile(fileUri?: vscode.Uri) {
    let target = fileUri;
    if (!target) {
      const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Transcribe",
        title: "Bytewise: Select Audio File to Transcribe",
        filters: {
          "Audio files (*.wav, *.pcm)": ["wav", "pcm"],
          "All files": ["*"],
        },
      });
      if (!selected || selected.length === 0) return;
      target = selected[0]!;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(target);
      const pcm = wavTo24kPcm16(raw);
      await this.transcribeAudio(pcm);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Bytewise: Could not read audio file: ${msg}`);
    }
  }

  private post(message: ToWebview) {
    if (message.type === "entry" || message.type === "state") this.scheduleSave();
    void this.view?.webview.postMessage(message);
  }

  private postState() {
    this.post({
      type: "state",
      hasKey: Boolean(this.apiKey),
      model: vscode.workspace.getConfiguration("bytewise").get<string>("model", "muse-spark-1.3"),
      workspaceName: vscode.workspace.workspaceFolders?.[0]?.name ?? null,
      entries: this.session.entries,
      busy: this.session.busy,
      sessionTitle: deriveSessionTitle(this.session.entries),
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const asset = (folder: "dist" | "media", name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, folder, name));
    // Strict CSP: only our bundled script and stylesheet; no inline code, no network.
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${asset("media", "chat.css")}" />
  <title>Bytewise</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset("dist", "webview.js")}"></script>
</body>
</html>`;
  }
}
