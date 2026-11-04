import fs from "node:fs";
import type { FileContentResponse } from "@bytewise/shared";
import { AppError } from "../errors/app-error";
import { languageForPath } from "./path-policy";
import { resolveProjectFile } from "./project-root";

export const MAX_READ_BYTES = 512 * 1024;

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

/** Reads a validated text file from the project, enforcing size and binary limits. */
export async function readProjectFile(
  projectRoot: string,
  inputPath: string,
  maxBytes = MAX_READ_BYTES,
): Promise<FileContentResponse> {
  const { absolutePath, relativePath } = await resolveProjectFile(projectRoot, inputPath);

  const { size } = await fs.promises.stat(absolutePath);
  if (size > maxBytes) {
    throw new AppError(
      413,
      "file_too_large",
      `"${relativePath}" is ${Math.round(size / 1024)} KB; the limit is ${maxBytes / 1024} KB.`,
    );
  }

  const buffer = await fs.promises.readFile(absolutePath);
  if (looksBinary(buffer)) {
    throw new AppError(415, "binary_file", `"${relativePath}" appears to be a binary file.`);
  }

  const content = buffer.toString("utf8");
  return {
    path: relativePath,
    content,
    size,
    lineCount: countLines(content),
    language: languageForPath(relativePath),
  };
}
