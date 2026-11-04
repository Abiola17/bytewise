import fs from "node:fs";
import path from "node:path";
import type { ProjectFile } from "@bytewise/shared";
import { isBinaryPath, isExcludedDirectory, isSensitiveFile } from "./path-policy";

export const DISCOVERY_LIMITS = {
  maxFiles: 2000,
  maxDepth: 12,
};

/**
 * Lists the files Bytewise is allowed to see, breadth-first and sorted.
 * Symlinks are skipped entirely so discovery can never leave the project.
 */
export async function discoverFiles(
  projectRoot: string,
  limits = DISCOVERY_LIMITS,
): Promise<{ files: ProjectFile[]; truncated: boolean }> {
  const files: ProjectFile[] = [];
  let truncated = false;
  let queue: Array<{ dir: string; depth: number }> = [{ dir: "", depth: 0 }];

  while (queue.length > 0 && !truncated) {
    const next: typeof queue = [];
    for (const { dir, depth } of queue) {
      const entries = await fs.promises.readdir(path.join(projectRoot, dir), {
        withFileTypes: true,
      });
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const relativePath = dir ? `${dir}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (isExcludedDirectory(entry.name)) continue;
          if (depth + 1 < limits.maxDepth) next.push({ dir: relativePath, depth: depth + 1 });
          else truncated = true;
        } else if (entry.isFile()) {
          if (isSensitiveFile(entry.name) || isBinaryPath(entry.name)) continue;
          if (files.length >= limits.maxFiles) {
            truncated = true;
            break;
          }
          const { size } = await fs.promises.stat(path.join(projectRoot, relativePath));
          files.push({ path: relativePath, size });
        }
      }
      if (truncated) break;
    }
    queue = next;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated };
}
