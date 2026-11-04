import * as vscode from "vscode";
import { ChatViewProvider, SECRET_KEY } from "./chat-view";
import { EditManager, REVIEW_SCHEME } from "./edit-manager";

const WELCOMED_KEY = "bytewise.welcomed";

/** Returned from activate() so the smoke test can check the panel really loaded. */
export interface BytewiseApi {
  isChatReady(): boolean;
  /** Exposed for the smoke test, which drives a real review end to end. */
  edits: EditManager;
}

/** Shows the Bytewise sidebar and focuses the chat. */
async function openChat() {
  await vscode.commands.executeCommand("workbench.view.extension.bytewise");
  await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
}

export async function activate(context: vscode.ExtensionContext): Promise<BytewiseApi> {
  const chat = new ChatViewProvider(context);

  // Always-visible entry point: the activity-bar icon can be hidden in overflow.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = "$(bug) Bytewise";
  statusItem.tooltip = "Open the Bytewise chat";
  statusItem.command = "bytewise.openChat";
  statusItem.show();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand("bytewise.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "Bytewise: Meta API key",
        prompt:
          "Stored in VS Code's encrypted secret storage. It is never written to files or shown in the panel.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim().length < 10 ? "That does not look like an API key." : null,
      });
      if (!key) return;
      await context.secrets.store(SECRET_KEY, key.trim());
      void vscode.window.showInformationMessage("Bytewise: Meta API key saved.");
    }),

    vscode.commands.registerCommand("bytewise.clearApiKey", async () => {
      await context.secrets.delete(SECRET_KEY);
      void vscode.window.showInformationMessage("Bytewise: Meta API key removed.");
    }),

    statusItem,
    chat.edits,
    vscode.workspace.registerTextDocumentContentProvider(REVIEW_SCHEME, chat.edits),
    // Accept / Reject buttons on the review diff's title bar.
    vscode.commands.registerCommand("bytewise.acceptEdit", (uri?: vscode.Uri) => {
      const id = EditManager.idFromUri(uri ?? vscode.window.activeTextEditor?.document.uri);
      if (id) return chat.edits.decide(id, "accept");
    }),
    vscode.commands.registerCommand("bytewise.rejectEdit", (uri?: vscode.Uri) => {
      const id = EditManager.idFromUri(uri ?? vscode.window.activeTextEditor?.document.uri);
      if (id) return chat.edits.decide(id, "reject");
    }),
    vscode.commands.registerCommand("bytewise.openChat", openChat),
    vscode.commands.registerCommand("bytewise.newChat", () => chat.newChat()),

    // Keep the panel in sync when the key changes (including from another window).
    context.secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY) void chat.loadKey();
    }),
  );

  await chat.loadKey();

  // First run after install: open the chat so it is easy to find.
  if (!context.globalState.get<boolean>(WELCOMED_KEY)) {
    await context.globalState.update(WELCOMED_KEY, true);
    await openChat();
    void vscode.window.showInformationMessage(
      "Bytewise is ready. Open it any time from “Bytewise” in the status bar or the bug icon in the activity bar.",
    );
  }

  return { isChatReady: () => chat.webviewReady, edits: chat.edits };
}

export function deactivate() {}
