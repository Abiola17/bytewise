import fs from "node:fs";
import path from "node:path";
import type { ProjectFile, SearchMatch } from "@bytewise/shared";

/** Files larger than this are skipped by search (lockfiles, bundles, fixtures). */
export const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const MAX_PREVIEW_CHARS = 200;

export interface SearchableFile {
  path: string;
  lines: string[];
}

/**
 * Loads the text of discovered files that are small enough to search.
 * `files` must come from `discoverFiles`, which already applied the path policy.
 */
export async function loadSearchableFiles(
  projectRoot: string,
  files: ProjectFile[],
): Promise<SearchableFile[]> {
  const result: SearchableFile[] = [];
  for (const file of files) {
    if (file.size > MAX_SEARCH_FILE_BYTES) continue;
    const buffer = await fs.promises.readFile(path.join(projectRoot, file.path));
    if (buffer.subarray(0, 8000).includes(0)) continue;
    result.push({ path: file.path, lines: buffer.toString("utf8").split(/\r?\n/) });
  }
  return result;
}

function preview(line: string, column: number): string {
  const trimmed = line.trim();
  if (trimmed.length <= MAX_PREVIEW_CHARS) return trimmed;
  const start = Math.max(0, column - 1 - MAX_PREVIEW_CHARS / 2);
  return line.slice(start, start + MAX_PREVIEW_CHARS).trim();
}

/** Case-insensitive literal search across files, stopping at `limit` matches. */
export function searchFiles(
  files: SearchableFile[],
  query: string,
  limit: number,
): { matches: SearchMatch[]; truncated: boolean } {
  const needle = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      const index = line.toLowerCase().indexOf(needle);
      if (index === -1) continue;
      if (matches.length >= limit) return { matches, truncated: true };
      matches.push({
        path: file.path,
        line: i + 1,
        column: index + 1,
        preview: preview(line, index + 1),
      });
    }
  }
  return { matches, truncated: false };
}
