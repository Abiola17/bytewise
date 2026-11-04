import fs from "node:fs";
import path from "node:path";

export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "other";
}

/**
 * The only way the agent touches the workspace. Paths are project-relative
 * POSIX paths that the caller has already validated with the path policy.
 */
export interface WorkspaceFs {
  readonly rootName: string;
  readDirectory(relativeDir: string): Promise<DirEntry[]>;
  stat(relativePath: string): Promise<{ kind: DirEntry["kind"]; size: number } | null>;
  /** Text of the file; implementations may prefer unsaved editor content. */
  readText(relativePath: string): Promise<string>;
}

/** Node implementation, used by unit tests and scripts. Symlinks are reported as "other". */
export function createNodeWorkspaceFs(root: string): WorkspaceFs {
  const abs = (rel: string) => path.join(root, ...rel.split("/").filter(Boolean));
  return {
    rootName: path.basename(root),
    async readDirectory(rel) {
      const entries = await fs.promises.readdir(abs(rel), { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        kind: e.isSymbolicLink()
          ? "other"
          : e.isDirectory()
            ? "directory"
            : e.isFile()
              ? "file"
              : "other",
      }));
    },
    async stat(rel) {
      try {
        const s = await fs.promises.lstat(abs(rel));
        return {
          kind: s.isSymbolicLink()
            ? "other"
            : s.isDirectory()
              ? "directory"
              : s.isFile()
                ? "file"
                : "other",
          size: s.size,
        };
      } catch {
        return null;
      }
    },
    async readText(rel) {
      return fs.promises.readFile(abs(rel), "utf8");
    },
  };
}
