import { createHash } from "node:crypto";
import { createTwoFilesPatch, diffLines } from "diff";
import { checkRelativePath } from "../filesystem/path-policy";
import { normalizeRelativePath } from "../filesystem/project-root";

export const PATCH_LIMITS = {
  maxFiles: 5,
  maxEditsPerFile: 10,
  maxChangedLines: 200,
};

/** Files a patch may never touch: changing tests or dependencies would undermine verification. */
const PROTECTED_FILE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/,
    reason: "test files cannot be modified by a patch (they are used to verify the fix)",
  },
  {
    pattern: /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
    reason: "dependency manifests and lockfiles cannot be modified by a patch",
  },
];

export interface ProposedEdit {
  find: string;
  replace: string;
}

export interface ProposedFileChange {
  path: string;
  summary: string;
  edits: ProposedEdit[];
}

export interface BuiltPatchFile {
  path: string;
  summary: string;
  originalContent: string;
  proposedContent: string;
  originalHash: string;
  proposedHash: string;
  diff: string;
  additions: number;
  deletions: number;
}

export class PatchValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "PatchValidationError";
  }
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Returns why a path may not be patched, or null if it may. */
export function patchPathProblem(inputPath: string): string | null {
  let relativePath: string;
  try {
    relativePath = normalizeRelativePath(inputPath);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid path";
  }
  if (relativePath !== inputPath) return "path must be normalized and project-relative";
  const policy = checkRelativePath(relativePath);
  if (!policy.allowed) return policy.reason;
  for (const { pattern, reason } of PROTECTED_FILE_PATTERNS) {
    if (pattern.test(relativePath)) return reason;
  }
  return null;
}

/**
 * Applies exact find/replace edits to known file contents and builds the diff.
 * Each `find` must occur exactly once in the file as it stands after the
 * previous edits, so an edit can never land in an ambiguous place.
 */
export function buildPatch(
  changes: ProposedFileChange[],
  currentFiles: Map<string, string>,
): BuiltPatchFile[] {
  const problems: string[] = [];

  if (changes.length === 0) problems.push("the patch contains no file changes");
  if (changes.length > PATCH_LIMITS.maxFiles) {
    problems.push(
      `the patch changes ${changes.length} files; the limit is ${PATCH_LIMITS.maxFiles}`,
    );
  }
  const seen = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.path)) problems.push(`"${change.path}" appears more than once`);
    seen.add(change.path);
  }
  if (problems.length > 0) throw new PatchValidationError(problems);

  const built: BuiltPatchFile[] = [];
  let changedLines = 0;

  for (const change of changes) {
    const pathProblem = patchPathProblem(change.path);
    if (pathProblem) {
      problems.push(`"${change.path}": ${pathProblem}`);
      continue;
    }
    const original = currentFiles.get(change.path);
    if (original === undefined) {
      problems.push(
        `"${change.path}" is not one of the provided files (new files cannot be created)`,
      );
      continue;
    }
    if (change.edits.length === 0 || change.edits.length > PATCH_LIMITS.maxEditsPerFile) {
      problems.push(
        `"${change.path}" must have between 1 and ${PATCH_LIMITS.maxEditsPerFile} edits`,
      );
      continue;
    }

    const usesCrlf = original.includes("\r\n");
    let content = original;
    change.edits.forEach((edit, i) => {
      const find = usesCrlf ? edit.find.replace(/\r?\n/g, "\r\n") : edit.find;
      const replace = usesCrlf ? edit.replace.replace(/\r?\n/g, "\r\n") : edit.replace;
      if (find.length === 0) {
        problems.push(`"${change.path}" edit ${i + 1}: "find" is empty`);
        return;
      }
      if (find === replace) {
        problems.push(`"${change.path}" edit ${i + 1}: "find" and "replace" are identical`);
        return;
      }
      const occurrences = countOccurrences(content, find);
      if (occurrences !== 1) {
        problems.push(
          `"${change.path}" edit ${i + 1}: "find" text occurs ${occurrences} times (must be exactly once): ${JSON.stringify(find.slice(0, 120))}`,
        );
        return;
      }
      content = content.replace(find, () => replace);
    });

    if (content === original) continue;

    let additions = 0;
    let deletions = 0;
    for (const part of diffLines(original, content)) {
      if (part.added) additions += part.count ?? 0;
      if (part.removed) deletions += part.count ?? 0;
    }
    changedLines += additions + deletions;

    built.push({
      path: change.path,
      summary: change.summary,
      originalContent: original,
      proposedContent: content,
      originalHash: sha256(original),
      proposedHash: sha256(content),
      diff: createTwoFilesPatch(
        `a/${change.path}`,
        `b/${change.path}`,
        original,
        content,
        undefined,
        undefined,
        { context: 3 },
      ),
      additions,
      deletions,
    });
  }

  if (changedLines > PATCH_LIMITS.maxChangedLines) {
    problems.push(
      `the patch changes ${changedLines} lines; the limit is ${PATCH_LIMITS.maxChangedLines} (prefer a smaller fix)`,
    );
  }
  if (problems.length === 0 && built.length === 0) problems.push("the patch makes no changes");
  if (problems.length > 0) throw new PatchValidationError(problems);

  return built.sort((a, b) => a.path.localeCompare(b.path));
}
