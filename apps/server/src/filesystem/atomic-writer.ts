import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { resolveProjectFile } from "./project-root";

export interface FileWrite {
  relativePath: string;
  /** sha256 of the content the file must currently have. */
  expectedHash: string;
  content: string;
}

export type WriteOutcome =
  | { ok: true }
  | { ok: false; reason: "stale"; paths: string[] }
  | { ok: false; reason: "io_error"; message: string; rolledBack: boolean };

const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * Replaces several project files as one unit:
 *   1. re-resolve every path under the project root and verify its current hash;
 *   2. write each new content to a temp file beside the target;
 *   3. rename temps over targets; on any failure, restore already-replaced files.
 * Either every file ends up with its new content, or every file keeps its original.
 */
export async function writeFilesAtomically(
  projectRoot: string,
  writes: FileWrite[],
): Promise<WriteOutcome> {
  const targets: Array<{ absolutePath: string; original: Buffer; mode: number; write: FileWrite }> =
    [];
  const stale: string[] = [];

  for (const write of writes) {
    const { absolutePath } = await resolveProjectFile(projectRoot, write.relativePath);
    const original = await fs.promises.readFile(absolutePath);
    if (hash(original) !== write.expectedHash) stale.push(write.relativePath);
    const { mode } = await fs.promises.stat(absolutePath);
    targets.push({ absolutePath, original, mode, write });
  }
  if (stale.length > 0) return { ok: false, reason: "stale", paths: stale };

  const temps: string[] = [];
  const replaced: typeof targets = [];
  try {
    for (const target of targets) {
      const temp = path.join(
        path.dirname(target.absolutePath),
        `.${path.basename(target.absolutePath)}.bytewise-${randomBytes(6).toString("hex")}.tmp`,
      );
      await fs.promises.writeFile(temp, target.write.content, { mode: target.mode, flag: "wx" });
      temps.push(temp);
    }
    for (const [i, target] of targets.entries()) {
      await fs.promises.rename(temps[i]!, target.absolutePath);
      replaced.push(target);
    }
    return { ok: true };
  } catch (error) {
    let rolledBack = true;
    for (const target of replaced) {
      try {
        await fs.promises.writeFile(target.absolutePath, target.original, { mode: target.mode });
      } catch {
        rolledBack = false;
      }
    }
    await Promise.all(temps.map((t) => fs.promises.rm(t, { force: true })));
    return {
      ok: false,
      reason: "io_error",
      message: error instanceof Error ? error.message : "write failed",
      rolledBack,
    };
  }
}
