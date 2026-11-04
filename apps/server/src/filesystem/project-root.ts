import fs from "node:fs";
import path from "node:path";
import { AppError, badRequest, notFound } from "../errors/app-error";
import { checkRelativePath } from "./path-policy";

/**
 * Resolves a directory name to an absolute path that is guaranteed to be a
 * real directory directly inside `projectsDir` (symlinks resolved).
 */
export function resolveProjectRoot(projectsDir: string, directory: string): string {
  const candidate = path.resolve(projectsDir, directory);
  if (path.dirname(candidate) !== projectsDir) {
    throw badRequest("Project directory must be a direct child of the projects directory.");
  }

  let realRoot: string;
  let realProjectsDir: string;
  try {
    realRoot = fs.realpathSync(candidate);
    realProjectsDir = fs.realpathSync(projectsDir);
  } catch {
    throw notFound(`Project directory "${directory}"`);
  }
  if (path.dirname(realRoot) !== realProjectsDir) {
    throw badRequest("Project directory resolves outside the projects directory.");
  }
  if (!fs.statSync(realRoot).isDirectory()) {
    throw badRequest(`"${directory}" is not a directory.`);
  }
  return realRoot;
}

/** Normalizes user input to a project-relative POSIX path, or throws. */
export function normalizeRelativePath(input: string): string {
  if (input.includes("\0")) throw badRequest("Invalid path.");
  const posix = input.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) {
    throw badRequest("Absolute paths are not allowed.");
  }
  const normalized = path.posix.normalize(posix).replace(/^\.\//, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw badRequest("Path must stay inside the project.");
  }
  return normalized.replace(/\/$/, "");
}

/**
 * Resolves a project-relative path to an absolute path of an existing regular
 * file inside `projectRoot`, enforcing the path policy and rejecting symlinks
 * that escape the project. Returns the normalized relative path too.
 */
export async function resolveProjectFile(
  projectRoot: string,
  input: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = normalizeRelativePath(input);

  const policy = checkRelativePath(relativePath);
  if (!policy.allowed) throw new AppError(403, "path_not_allowed", policy.reason);

  const candidate = path.resolve(projectRoot, relativePath);
  if (!candidate.startsWith(projectRoot + path.sep)) {
    throw badRequest("Path must stay inside the project.");
  }

  let real: string;
  try {
    real = await fs.promises.realpath(candidate);
  } catch {
    throw notFound(`File "${relativePath}"`);
  }
  if (!real.startsWith(projectRoot + path.sep)) {
    throw new AppError(403, "path_not_allowed", "Path resolves outside the project.");
  }
  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) throw badRequest(`"${relativePath}" is not a file.`);

  return { absolutePath: real, relativePath };
}
