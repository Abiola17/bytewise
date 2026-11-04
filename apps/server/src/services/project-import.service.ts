import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  IMPORT_LIMITS,
  type ImportProjectRequest,
  type ImportProjectResponse,
} from "@bytewise/shared";
import { AppError, badRequest, conflict } from "../errors/app-error";
import { checkRelativePath } from "../filesystem/path-policy";
import { normalizeRelativePath } from "../filesystem/project-root";
import type { ProjectService } from "./project.service";

const MAX_REPORTED_SKIPS = 50;

/**
 * Creates a new project folder inside PROJECTS_DIR from files uploaded by the
 * browser, then registers it. Files are written to a hidden staging folder and
 * moved into place only when everything succeeded, so a failed import leaves
 * nothing behind. Existing projects are never overwritten.
 */
export function createProjectImportService(deps: {
  projectService: ProjectService;
  projectsDir: string;
}) {
  const { projectService, projectsDir } = deps;

  return {
    async importProject(input: ImportProjectRequest): Promise<ImportProjectResponse> {
      const target = path.join(projectsDir, input.name);
      if (path.dirname(target) !== path.resolve(projectsDir)) {
        throw badRequest("The project name must be a single folder name.");
      }
      if (fs.existsSync(target)) {
        throw conflict(
          `A project folder named "${input.name}" already exists. Choose another name.`,
        );
      }

      const skipped: ImportProjectResponse["skipped"] = [];
      const accepted = new Map<string, Buffer>();
      let totalBytes = 0;

      for (const file of input.files) {
        let relativePath: string;
        try {
          relativePath = normalizeRelativePath(file.path);
        } catch (error) {
          skipped.push({
            path: file.path,
            reason: error instanceof Error ? error.message : "Invalid path.",
          });
          continue;
        }
        const policy = checkRelativePath(relativePath);
        if (!policy.allowed) {
          skipped.push({ path: relativePath, reason: policy.reason });
          continue;
        }
        if (accepted.has(relativePath)) {
          skipped.push({ path: relativePath, reason: "Duplicate path." });
          continue;
        }
        const content = Buffer.from(file.content, "base64");
        if (content.length > IMPORT_LIMITS.maxFileBytes) {
          skipped.push({ path: relativePath, reason: "File is larger than 1 MB." });
          continue;
        }
        totalBytes += content.length;
        if (totalBytes > IMPORT_LIMITS.maxTotalBytes) {
          throw new AppError(413, "import_too_large", "The project is larger than 25 MB.");
        }
        accepted.set(relativePath, content);
      }

      // A path cannot be both a file and a folder (e.g. "src" and "src/a.js").
      for (const p of accepted.keys()) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) {
          const parent = parts.slice(0, i).join("/");
          if (accepted.has(parent)) {
            throw badRequest(`"${parent}" is both a file and a folder in the upload.`);
          }
        }
      }

      if (accepted.size === 0) {
        throw badRequest("None of the uploaded files can be imported (see the skipped list).", {
          skipped: skipped.slice(0, MAX_REPORTED_SKIPS),
        });
      }

      fs.mkdirSync(projectsDir, { recursive: true });
      const staging = path.join(projectsDir, `.import-${randomBytes(6).toString("hex")}`);
      try {
        for (const [relativePath, content] of accepted) {
          const destination = path.join(staging, relativePath);
          // normalizeRelativePath already forbids "..", this guards the join itself.
          if (!destination.startsWith(staging + path.sep)) {
            throw badRequest(`Invalid path "${relativePath}".`);
          }
          await fs.promises.mkdir(path.dirname(destination), { recursive: true });
          await fs.promises.writeFile(destination, content, { flag: "wx" });
        }
        if (fs.existsSync(target)) {
          throw conflict(`A project folder named "${input.name}" already exists.`);
        }
        await fs.promises.rename(staging, target);
      } catch (error) {
        await fs.promises.rm(staging, { recursive: true, force: true });
        throw error;
      }

      try {
        const project = projectService.register({ directory: input.name });
        return {
          project,
          importedFiles: accepted.size,
          skipped: skipped.slice(0, MAX_REPORTED_SKIPS),
        };
      } catch (error) {
        // Registration failed (e.g. invalid package.json): remove what we created.
        await fs.promises.rm(target, { recursive: true, force: true });
        throw error;
      }
    },
  };
}

export type ProjectImportService = ReturnType<typeof createProjectImportService>;
