// Runs inside a real VS Code instance (started by run-vscode-tests.mjs) with a
// temporary workspace folder open.
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { runTool } from "../../src/agent/tools";
import type { EditProposal } from "../../src/agent/edit-tools";
import { createVscodeWorkspaceFs } from "../../src/agent/vscode-workspace-fs";
import { REVIEW_SCHEME, type EditManager } from "../../src/edit-manager";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("bytewise.bytewise");
  assert.ok(extension, "the Bytewise extension is installed in the test instance");

  // Opening the view activates the extension (activation events are inferred from contributions).
  await vscode.commands.executeCommand("workbench.view.extension.bytewise");
  await extension.activate();
  assert.equal(extension.isActive, true, "the extension activates");

  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "bytewise.openChat",
    "bytewise.setApiKey",
    "bytewise.clearApiKey",
    "bytewise.newChat",
  ]) {
    assert.ok(commands.includes(id), `command ${id} is registered`);
  }
  await vscode.commands.executeCommand("bytewise.openChat");
  // The panel's script must load (no CSP or script errors) and report "ready".
  const api = extension.exports as { isChatReady(): boolean };
  for (let i = 0; i < 100 && !api.isChatReady(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(api.isChatReady(), "the chat panel renders and its script runs");
  await vscode.commands.executeCommand("bytewise.newChat");

  // The agent's tools work through VS Code's own file system API.
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  const fs = createVscodeWorkspaceFs(folder);

  const list = await runTool(fs, "list_files", "{}");
  assert.ok(list.ok, "list_files works");
  const listed = list.output.split("\n");
  assert.ok(listed.includes("src/session.js"), "source files are listed");
  for (const hidden of [".env", "node_modules/", "linkdir/"]) {
    assert.ok(!listed.includes(hidden), `${hidden} is hidden`);
  }

  const read = await runTool(fs, "read_file", JSON.stringify({ path: "src/session.js" }));
  assert.ok(read.output.includes("1 | const signature"), "read_file returns numbered lines");

  const search = await runTool(fs, "search_files", JSON.stringify({ query: "config.secret" }));
  assert.equal(
    search.output,
    "src/session.js:1: const signature = createHmac('sha256', config.secret);",
  );

  for (const blocked of [".env", "linkdir/outside.js", "../outside.js"]) {
    const out = await runTool(fs, "read_file", JSON.stringify({ path: blocked }));
    assert.equal(out.ok, false, `${blocked} is refused`);
    assert.ok(!out.output.includes("SECRET=shh") && !out.output.includes("OUTSIDE_MARKER"));
  }

  // Unsaved editor changes are what the agent reads.
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "src/session.js"),
  );
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit((e) => e.insert(new vscode.Position(0, 0), "// unsaved edit\n"));
  const dirty = await runTool(fs, "read_file", JSON.stringify({ path: "src/session.js" }));
  assert.ok(
    dirty.output.includes("1 | // unsaved edit"),
    "reads the open editor's unsaved content",
  );
  await vscode.commands.executeCommand("workbench.action.files.revert");

  await reviewFlow(folder, (extension.exports as { edits: EditManager }).edits);

  console.log("Bytewise VS Code smoke test passed.");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reviewTabs() {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) =>
        t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme === REVIEW_SCHEME,
    );
}

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 100 && !check(); i++) await wait(50);
  assert.ok(check(), what);
}

async function diskText(folder: vscode.WorkspaceFolder, rel: string) {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, rel));
  return new TextDecoder().decode(bytes);
}

/** Drives real reviews through VS Code: diff tab, title-bar buttons, writes, undo. */
async function reviewFlow(folder: vscode.WorkspaceFolder, edits: EditManager) {
  const before = await diskText(folder, "src/session.js");
  const proposal = (id: string, over: Partial<EditProposal> = {}): EditProposal => ({
    id,
    kind: "edit",
    path: "src/session.js",
    before,
    after: before.replace("config.secret", "config.sessionSecret"),
    explanation: "Fix the key name.",
    additions: 1,
    deletions: 1,
    warning: null,
    ...over,
  });

  // Reject: the diff opens, nothing is written.
  const rejected = edits.requestApproval(proposal("r1"));
  await waitFor(() => reviewTabs().length === 1, "the review diff opens");
  const modified = (reviewTabs()[0]!.input as vscode.TabInputTextDiff).modified;
  await vscode.commands.executeCommand("bytewise.rejectEdit", modified);
  assert.deepEqual(await rejected, { decision: "rejected" });
  assert.equal(
    await diskText(folder, "src/session.js"),
    before,
    "rejecting leaves the file unchanged",
  );
  await waitFor(() => reviewTabs().length === 0, "the review diff closes");

  // Accept via the diff title-bar command: written to disk, and undoable.
  const accepted = edits.requestApproval(proposal("a1"));
  await waitFor(() => reviewTabs().length === 1, "the review diff opens again");
  const uri = (reviewTabs()[0]!.input as vscode.TabInputTextDiff).modified;
  await vscode.commands.executeCommand("bytewise.acceptEdit", uri);
  assert.deepEqual(await accepted, { decision: "accepted" });
  const after = await diskText(folder, "src/session.js");
  assert.ok(after.includes("config.sessionSecret"), "accepting writes and saves the file");

  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "src/session.js"),
  );
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("undo");
  assert.equal(doc.getText(), before, "the accepted edit can be undone");
  await doc.save();

  // Stale: the file no longer matches what the proposal was made from.
  const stale = edits.requestApproval(proposal("s1", { before: "something else\n" }));
  await waitFor(() => reviewTabs().length === 1, "the stale review opens");
  await edits.decide("s1", "accept");
  const staleResult = await stale;
  assert.equal(staleResult.decision, "failed", "a stale proposal is not applied");
  assert.equal(await diskText(folder, "src/session.js"), before);

  // Create a new file in a new folder.
  const created = edits.requestApproval(
    proposal("c1", {
      kind: "create",
      path: "src/utils/format.js",
      before: "",
      after: "export const f = 1;\n",
    }),
  );
  await waitFor(() => reviewTabs().length === 1, "the new-file review opens");
  await edits.decide("c1", "accept");
  assert.deepEqual(await created, { decision: "accepted" });
  assert.equal(await diskText(folder, "src/utils/format.js"), "export const f = 1;\n");

  // Stop rejects anything still waiting.
  const pending = edits.requestApproval(proposal("p1"));
  await waitFor(() => reviewTabs().length === 1, "a pending review opens");
  edits.rejectAll("Stopped.");
  assert.equal((await pending).decision, "rejected");
}
