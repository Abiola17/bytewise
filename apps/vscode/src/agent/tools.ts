import path from "node:path";
import { z } from "zod";
import {
  checkRelativePath,
  isBinaryPath,
  isExcludedDirectory,
  isSensitiveFile,
} from "@bytewise/shared";
import type { ToolDefinition } from "../meta/meta-client";
import type { WorkspaceFs } from "./workspace-fs";

export const TOOL_LIMITS = {
  listMaxEntries: 400,
  listMaxDepth: 6,
  readMaxLines: 400,
  readMaxChars: 60_000,
  readMaxFileBytes: 1024 * 1024,
  searchMaxMatches: 80,
  searchMaxFiles: 3000,
  searchMaxFileBytes: 256 * 1024,
};

export interface ToolOutcome {
  ok: boolean;
  /** Text returned to the model. */
  output: string;
  /** One line for the panel, e.g. "Read src/a.js (lines 1–40)". */
  summary: string;
  /** File the step refers to, so the panel can open it. */
  path?: string;
  line?: number;
}

/** Definitions sent to the model (JSON Schema). */
export const READ_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_files",
    description:
      "List files and folders in the workspace. Dependencies, build output, version control, secrets and binaries are hidden. Use it to discover the project structure.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: 'Folder relative to the workspace root, "" for the root.',
        },
        max_depth: { type: "integer", minimum: 1, maximum: TOOL_LIMITS.listMaxDepth },
      },
    },
  },
  {
    name: "read_file",
    description: `Read a text file. Returns numbered lines (at most ${TOOL_LIMITS.readMaxLines} per call); use start_line/end_line for long files.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", description: "File path relative to the workspace root." },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "search_files",
    description:
      "Case-insensitive literal text search across workspace files. Returns matching lines as path:line: text. Use it to find where a function, variable, route or error message appears.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Text to search for (not a regex)." },
        path: { type: "string", description: "Optional folder to limit the search to." },
      },
    },
  },
];

const listArgs = z.object({
  path: z.string().max(1024).optional(),
  max_depth: z.number().int().min(1).max(TOOL_LIMITS.listMaxDepth).optional(),
});
const readArgs = z.object({
  path: z.string().min(1).max(1024),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
});
const searchArgs = z.object({
  query: z.string().min(2).max(200),
  path: z.string().max(1024).optional(),
});

const fail = (summary: string, output: string): ToolOutcome => ({ ok: false, summary, output });

/** Normalizes a model-supplied path to a workspace-relative POSIX path, or explains why not. */
export function normalizeToolPath(input: string): { path: string } | { error: string } {
  if (input.includes("\0")) return { error: "Invalid path." };
  // Models sometimes wrap paths in quotes or write "/" or "./" meaning the root.
  const posix = input
    .trim()
    .replace(/^(["'`])(.*)\1$/, "$2")
    .trim()
    .replace(/\\/g, "/");
  if (posix === "/" || posix === "./" || posix === ".") return { path: "" };
  if (posix.startsWith("/") || /^[A-Za-z]:/.test(posix) || posix.startsWith("~")) {
    return { error: "Use a path relative to the workspace root, not an absolute path." };
  }
  // Check for ".." on the normalized form, and strip nothing else: ".env" must stay ".env".
  const normalized = path.posix.normalize(posix || ".").replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    return { error: "That path is outside the workspace." };
  }
  return { path: normalized === "." ? "" : normalized };
}

/**
 * Every folder on the way to `rel` must be a real directory: a symlinked
 * folder could lead outside the workspace even if the file itself is not a link.
 */
export async function hasRealParents(fs: WorkspaceFs, rel: string): Promise<boolean> {
  const parts = rel.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const stat = await fs.stat(parts.slice(0, i).join("/"));
    if (!stat || stat.kind !== "directory") return false;
  }
  return true;
}

async function isRealDirectory(fs: WorkspaceFs, rel: string): Promise<boolean> {
  if (!rel) return true;
  const stat = await fs.stat(rel);
  return stat?.kind === "directory" && (await hasRealParents(fs, rel));
}

function checkFolder(rel: string): string | null {
  for (const segment of rel.split("/").filter(Boolean)) {
    if (isExcludedDirectory(segment))
      return `"${segment}" is excluded (dependencies/build/version control).`;
  }
  return null;
}

async function listFiles(fs: WorkspaceFs, raw: unknown): Promise<ToolOutcome> {
  const args = listArgs.safeParse(raw ?? {});
  if (!args.success)
    return fail("Listed files (invalid arguments)", "Invalid arguments for list_files.");
  const target = normalizeToolPath(args.data.path ?? "");
  if ("error" in target) return fail("List refused", target.error);
  const blocked = checkFolder(target.path);
  if (blocked) return fail(`List refused: ${target.path}`, blocked);
  if (!(await isRealDirectory(fs, target.path))) {
    return fail(
      `List failed: ${target.path}`,
      `"${target.path}" is not a folder in the workspace. Paths are relative to the workspace root; use "" for the root itself.`,
    );
  }

  const maxDepth = args.data.max_depth ?? 3;
  const lines: string[] = [];
  let truncated = false;
  let queue: Array<{ dir: string; depth: number }> = [{ dir: target.path, depth: 1 }];

  while (queue.length > 0 && !truncated) {
    const next: typeof queue = [];
    for (const { dir, depth } of queue) {
      let entries;
      try {
        entries = await fs.readDirectory(dir);
      } catch {
        if (dir === target.path)
          return fail(`List failed: ${dir || "/"}`, `Folder "${dir}" was not found.`);
        continue;
      }
      entries.sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name),
      );
      for (const entry of entries) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          if (isExcludedDirectory(entry.name)) continue;
          lines.push(`${rel}/`);
          if (depth < maxDepth) next.push({ dir: rel, depth: depth + 1 });
        } else if (entry.kind === "file") {
          if (isSensitiveFile(entry.name) || isBinaryPath(entry.name)) continue;
          lines.push(rel);
        }
        if (lines.length >= TOOL_LIMITS.listMaxEntries) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    queue = next;
  }

  const where = target.path || fs.rootName;
  const output =
    lines.length === 0
      ? "(no visible files)"
      : lines.join("\n") +
        (truncated
          ? `\n…(stopped at ${TOOL_LIMITS.listMaxEntries} entries; list a subfolder)`
          : "");
  return {
    ok: true,
    output,
    summary: `Listed ${where} (${lines.length} entries)`,
    path: target.path || undefined,
  };
}

async function readFile(fs: WorkspaceFs, raw: unknown): Promise<ToolOutcome> {
  const args = readArgs.safeParse(raw);
  if (!args.success) return fail("Read (invalid arguments)", 'read_file needs a "path".');
  const target = normalizeToolPath(args.data.path);
  if ("error" in target) return fail("Read refused", target.error);
  const policy = checkRelativePath(target.path);
  if (!policy.allowed) return fail(`Read refused: ${target.path}`, policy.reason);

  const stat = await fs.stat(target.path);
  if (!stat) return fail(`Read failed: ${target.path}`, `File "${target.path}" was not found.`);
  if (!(await hasRealParents(fs, target.path))) {
    return fail(`Read refused: ${target.path}`, "The path goes through a linked folder.");
  }
  if (stat.kind !== "file")
    return fail(`Read refused: ${target.path}`, `"${target.path}" is not a regular file.`);
  if (stat.size > TOOL_LIMITS.readMaxFileBytes) {
    return fail(`Read refused: ${target.path}`, "The file is larger than 1 MB.");
  }

  let text: string;
  try {
    text = await fs.readText(target.path);
  } catch {
    return fail(`Read failed: ${target.path}`, "The file could not be read.");
  }
  if (text.includes("\0")) return fail(`Read refused: ${target.path}`, "The file looks binary.");

  const all = text.split(/\r?\n/);
  if (all.length > 1 && all[all.length - 1] === "") all.pop();
  const start = Math.min(args.data.start_line ?? 1, Math.max(1, all.length));
  let end = Math.min(
    args.data.end_line ?? start + TOOL_LIMITS.readMaxLines - 1,
    all.length,
    start + TOOL_LIMITS.readMaxLines - 1,
  );
  if (end < start) end = start;

  const numbered: string[] = [];
  let chars = 0;
  for (let n = start; n <= end; n++) {
    const line = `${String(n).padStart(5)} | ${all[n - 1] ?? ""}`;
    if (chars + line.length > TOOL_LIMITS.readMaxChars) {
      end = n - 1;
      break;
    }
    numbered.push(line);
    chars += line.length + 1;
  }
  const more =
    end < all.length
      ? `\n…(lines ${end + 1}–${all.length} not shown; call read_file with start_line=${end + 1})`
      : "";
  return {
    ok: true,
    output: `${target.path} — lines ${start}–${end} of ${all.length}\n${numbered.join("\n")}${more}`,
    summary: `Read ${target.path} (lines ${start}–${end} of ${all.length})`,
    path: target.path,
    line: start,
  };
}

async function searchFiles(fs: WorkspaceFs, raw: unknown): Promise<ToolOutcome> {
  const args = searchArgs.safeParse(raw);
  if (!args.success)
    return fail(
      "Search (invalid arguments)",
      'search_files needs a "query" of at least 2 characters.',
    );
  const target = normalizeToolPath(args.data.path ?? "");
  if ("error" in target) return fail("Search refused", target.error);
  const blocked = checkFolder(target.path);
  if (blocked) return fail("Search refused", blocked);
  if (!(await isRealDirectory(fs, target.path))) {
    return fail("Search refused", `"${target.path}" is not a folder in the workspace.`);
  }

  const needle = args.data.query.toLowerCase();
  const matches: string[] = [];
  let filesScanned = 0;
  let firstHit: { path: string; line: number } | undefined;
  let queue = [target.path];

  outer: while (queue.length > 0) {
    const next: string[] = [];
    for (const dir of queue) {
      let entries;
      try {
        entries = await fs.readDirectory(dir);
      } catch {
        continue;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          if (!isExcludedDirectory(entry.name)) next.push(rel);
          continue;
        }
        if (entry.kind !== "file" || !checkRelativePath(rel).allowed) continue;
        if (++filesScanned > TOOL_LIMITS.searchMaxFiles) break outer;
        const stat = await fs.stat(rel);
        if (!stat || stat.size > TOOL_LIMITS.searchMaxFileBytes) continue;
        let text: string;
        try {
          text = await fs.readText(rel);
        } catch {
          continue;
        }
        if (text.includes("\0")) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]!.toLowerCase().includes(needle)) continue;
          matches.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
          firstHit ??= { path: rel, line: i + 1 };
          if (matches.length >= TOOL_LIMITS.searchMaxMatches) break outer;
        }
      }
    }
    queue = next;
  }

  const output =
    matches.length === 0
      ? `No matches for "${args.data.query}".`
      : matches.join("\n") +
        (matches.length >= TOOL_LIMITS.searchMaxMatches
          ? "\n…(more matches not shown; refine the query)"
          : "");
  return {
    ok: true,
    output,
    summary: `Searched for "${args.data.query}" (${matches.length} ${matches.length === 1 ? "match" : "matches"})`,
    path: firstHit?.path,
    line: firstHit?.line,
  };
}

/** Runs one tool call. Never throws: problems are returned to the model as text. */
export async function runTool(
  fs: WorkspaceFs,
  name: string,
  rawArguments: string,
): Promise<ToolOutcome> {
  let args: unknown;
  try {
    args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return fail(`${name} (invalid arguments)`, "The tool arguments were not valid JSON.");
  }
  switch (name) {
    case "list_files":
      return listFiles(fs, args);
    case "read_file":
      return readFile(fs, args);
    case "search_files":
      return searchFiles(fs, args);
    default:
      return fail(
        `Unknown tool ${name}`,
        `There is no tool named "${name}". Available: list_files, read_file, search_files.`,
      );
  }
}
