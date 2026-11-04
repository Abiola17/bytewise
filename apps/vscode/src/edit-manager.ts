import * as vscode from "vscode";
import type { EditDecision, EditHost, EditProposal } from "./agent/edit-tools";
import type { ChatEntry } from "./protocol";

export const REVIEW_SCHEME = "bytewise-review";

type ApprovalEntry = Extract<ChatEntry, { role: "approval" }>;

interface Pending {
  proposal: EditProposal;
  entry: ApprovalEntry;
  resolve: (decision: EditDecision) => void;
}

/**
 * Shows proposed edits in VS Code's diff view and writes them only when the
 * developer accepts. Writes go through WorkspaceEdit, so they can be undone.
 */
export class EditManager implements EditHost, vscode.TextDocumentContentProvider {
  private readonly pending = new Map<string, Pending>();
  private readonly contents = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly folder: () => vscode.WorkspaceFolder | undefined,
    private readonly onEntry: (entry: ChatEntry) => void,
  ) {}

  /** Virtual documents for the two sides of the review diff. */
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  private reviewUri(id: string, side: "original" | "proposed", path: string) {
    // Keep the file name and extension so the diff gets syntax highlighting.
    return vscode.Uri.from({ scheme: REVIEW_SCHEME, path: `/${id}/${side}/${path}` });
  }

  /** The proposal id from a review document's URI (used by the diff title buttons). */
  static idFromUri(uri: vscode.Uri | undefined): string | undefined {
    if (uri?.scheme !== REVIEW_SCHEME) return undefined;
    return uri.path.split("/")[1];
  }

  async requestApproval(proposal: EditProposal): Promise<EditDecision> {
    const entry: ApprovalEntry = {
      id: proposal.id,
      role: "approval",
      kind: proposal.kind,
      path: proposal.path,
      explanation: proposal.explanation,
      additions: proposal.additions,
      deletions: proposal.deletions,
      warning: proposal.warning,
      status: "pending",
    };
    const decision = new Promise<EditDecision>((resolve) => {
      this.pending.set(proposal.id, { proposal, entry, resolve });
    });
    this.contents.set(
      this.reviewUri(proposal.id, "original", proposal.path).toString(),
      proposal.before,
    );
    this.contents.set(
      this.reviewUri(proposal.id, "proposed", proposal.path).toString(),
      proposal.after,
    );
    this.onEntry(entry);
    await this.showDiff(proposal.id);
    return decision;
  }

  async showDiff(id: string) {
    const item = this.pending.get(id);
    if (!item) return;
    const { proposal } = item;
    await vscode.commands.executeCommand(
      "vscode.diff",
      this.reviewUri(id, "original", proposal.path),
      this.reviewUri(id, "proposed", proposal.path),
      `Bytewise: ${proposal.path} (${proposal.kind === "create" ? "new file" : "proposed"})`,
      { preview: false },
    );
  }

  async decide(id: string, choice: "accept" | "reject"): Promise<void> {
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    let decision: EditDecision;
    if (choice === "reject") {
      decision = { decision: "rejected" };
    } else {
      try {
        decision = await this.apply(item.proposal);
      } catch (error) {
        decision = {
          decision: "failed",
          reason: error instanceof Error ? error.message : "Writing the file failed.",
        };
      }
    }
    this.finish(item, decision);
  }

  /** Rejects everything still waiting (Stop, New Chat, or the extension shutting down). */
  rejectAll(note: string) {
    for (const [id, item] of this.pending) {
      this.pending.delete(id);
      this.finish(item, { decision: "rejected", note });
    }
  }

  private finish(item: Pending, decision: EditDecision) {
    const status =
      decision.decision === "accepted"
        ? "accepted"
        : decision.decision === "rejected"
          ? "rejected"
          : "failed";
    this.onEntry({
      ...item.entry,
      status,
      reason: decision.decision === "failed" ? decision.reason : undefined,
    });
    void this.closeDiff(item.proposal);
    for (const side of ["original", "proposed"] as const) {
      this.contents.delete(this.reviewUri(item.proposal.id, side, item.proposal.path).toString());
    }
    item.resolve(decision);
  }

  private async closeDiff(proposal: EditProposal) {
    const target = this.reviewUri(proposal.id, "proposed", proposal.path).toString();
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter(
        (t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.toString() === target,
      );
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
  }

  private async apply(proposal: EditProposal): Promise<EditDecision> {
    const folder = this.folder();
    if (!folder) return { decision: "failed", reason: "No folder is open." };
    const uri = vscode.Uri.joinPath(folder.uri, ...proposal.path.split("/"));
    const edit = new vscode.WorkspaceEdit();

    if (proposal.kind === "create") {
      try {
        await vscode.workspace.fs.stat(uri);
        return { decision: "failed", reason: `${proposal.path} was created in the meantime.` };
      } catch {
        // does not exist: good
      }
      edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
      edit.insert(uri, new vscode.Position(0, 0), proposal.after);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      // Stale check: the file must be exactly what the proposal was made from.
      if (doc.getText() !== proposal.before) {
        return {
          decision: "failed",
          reason: `${proposal.path} changed after the edit was proposed, so it was not applied.`,
        };
      }
      const end = doc.lineAt(doc.lineCount - 1).range.end;
      edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), end), proposal.after);
    }

    if (!(await vscode.workspace.applyEdit(edit))) {
      return { decision: "failed", reason: "VS Code could not apply the edit." };
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!(await doc.save()))
      return { decision: "failed", reason: `Saving ${proposal.path} failed.` };
    return { decision: "accepted" };
  }

  dispose() {
    this.rejectAll("VS Code closed the session.");
    this.changed.dispose();
  }
}
