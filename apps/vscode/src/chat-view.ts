import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { checkRelativePath } from "@bytewise/shared";
import { normalizeToolPath } from "./agent/tools";
import { createVscodeWorkspaceFs } from "./agent/vscode-workspace-fs";
import { createChatSession, type ChatSession } from "./chat-session";
import { EditManager } from "./edit-manager";
import { createMetaClient } from "./meta/meta-client";
import { isFromWebview, type ToWebview } from "./protocol";

export const SECRET_KEY = "bytewise.metaApiKey";

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

/** The sidebar chat panel. The API key never leaves the extension host. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "bytewise.chat";
  private view: vscode.WebviewView | undefined;
  /** True once the panel's script has loaded and reported in (used by the smoke test). */
  webviewReady = false;
  private apiKey: string | undefined;
  private readonly session: ChatSession;
  readonly edits: EditManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.edits = new EditManager(
      () => vscode.workspace.workspaceFolders?.[0],
      (entry) => this.session.record(entry, (e) => this.post({ type: "entry", entry: e })),
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
    });
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
        case "send":
          this.post({ type: "busy", busy: true, label: "Thinking…" });
          await this.session.send(
            raw.text,
            (entry) => this.post({ type: "entry", entry }),
            (label) => this.post({ type: "busy", busy: true, label }),
          );
          this.post({ type: "busy", busy: false });
          break;
        case "stop":
          // Pending reviews are rejected so the agent loop can finish.
          this.edits.rejectAll("The developer pressed Stop.");
          this.session.stop();
          break;
        case "decideEdit":
          await this.edits.decide(raw.id, raw.decision);
          break;
        case "showDiff":
          await this.edits.showDiff(raw.id);
          break;
        case "openFile":
          await openWorkspaceFile(raw.path, raw.line);
          break;
      }
    });
  }

  newChat() {
    this.edits.rejectAll("A new chat was started.");
    this.session.reset();
    this.postState();
  }

  private post(message: ToWebview) {
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
