import * as vscode from "vscode";
import type { DirEntry, WorkspaceFs } from "./workspace-fs";

function kindOf(type: vscode.FileType): DirEntry["kind"] {
  // Symbolic links are never followed: they could point outside the workspace.
  if (type & vscode.FileType.SymbolicLink) return "other";
  if (type === vscode.FileType.Directory) return "directory";
  if (type === vscode.FileType.File) return "file";
  return "other";
}

/**
 * Workspace access through VS Code's file system API, so it also works for
 * remote folders (SSH, containers, WSL). Reads prefer an open editor's
 * content, so the agent sees unsaved changes exactly as the developer does.
 */
export function createVscodeWorkspaceFs(folder: vscode.WorkspaceFolder): WorkspaceFs {
  const uri = (rel: string) => vscode.Uri.joinPath(folder.uri, ...rel.split("/").filter(Boolean));

  return {
    rootName: folder.name,
    async readDirectory(rel) {
      const entries = await vscode.workspace.fs.readDirectory(uri(rel));
      return entries.map(([name, type]) => ({ name, kind: kindOf(type) }));
    },
    async stat(rel) {
      try {
        const s = await vscode.workspace.fs.stat(uri(rel));
        return { kind: kindOf(s.type), size: s.size };
      } catch {
        return null;
      }
    },
    async readText(rel) {
      const target = uri(rel).toString();
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target);
      if (open) return open.getText();
      return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri(rel)));
    },
  };
}
