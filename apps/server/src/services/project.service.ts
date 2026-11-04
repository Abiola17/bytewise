import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  projectMetadataSchema,
  type CreateProjectRequest,
  type Project,
  type ProjectMetadata,
} from "@bytewise/shared";
import { badRequest, conflict, notFound } from "../errors/app-error";
import { resolveProjectRoot } from "../filesystem/project-root";
import type { ProjectsRepository } from "../repositories/projects.repository";
import type { ProjectRow } from "../database/schema";

const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

export function createProjectService(deps: { projects: ProjectsRepository; projectsDir: string }) {
  const { projects, projectsDir } = deps;

  function readMetadata(root: string): { metadata: ProjectMetadata; language: string } {
    let packageName: string | null = null;
    let scripts: string[] = [];
    let hasTypeScriptDependency = false;

    const packageJsonPath = path.join(root, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      if (fs.statSync(packageJsonPath).size > MAX_PACKAGE_JSON_BYTES) {
        throw badRequest("package.json is too large to inspect.");
      }
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      } catch {
        throw badRequest("package.json is not valid JSON.");
      }
      if (typeof pkg.name === "string") packageName = pkg.name;
      if (pkg.scripts && typeof pkg.scripts === "object") scripts = Object.keys(pkg.scripts);
      const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) };
      hasTypeScriptDependency = "typescript" in deps;
    }

    const hasTypeScript =
      hasTypeScriptDependency || fs.existsSync(path.join(root, "tsconfig.json"));
    const language = hasTypeScript ? "typescript" : packageName !== null ? "javascript" : "unknown";

    return {
      metadata: projectMetadataSchema.parse({ packageName, hasTypeScript, scripts }),
      language,
    };
  }

  function toDto(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      directory: row.directory,
      language: row.language,
      metadata: projectMetadataSchema.parse(JSON.parse(row.metadataJson)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    list(): Project[] {
      return projects.list().map(toDto);
    },

    get(id: string): Project {
      const row = projects.findById(id);
      if (!row) throw notFound("Project");
      return toDto(row);
    },

    /** Absolute, re-validated root of a registered project. Server-side only. */
    rootFor(id: string): string {
      const row = projects.findById(id);
      if (!row) throw notFound("Project");
      return resolveProjectRoot(projectsDir, row.directory);
    },

    /** Directories in PROJECTS_DIR that could be registered but are not yet. */
    listAvailable(): string[] {
      if (!fs.existsSync(projectsDir)) return [];
      const registered = new Set(projects.list().map((p) => p.directory));
      return fs
        .readdirSync(projectsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !registered.has(e.name))
        .map((e) => e.name)
        .sort();
    },

    register(input: CreateProjectRequest): Project {
      if (projects.findByDirectory(input.directory)) {
        throw conflict(`Project "${input.directory}" is already registered.`);
      }
      const root = resolveProjectRoot(projectsDir, input.directory);
      const { metadata, language } = readMetadata(root);
      const now = new Date().toISOString();

      const row = projects.insert({
        id: randomUUID(),
        name: input.name ?? metadata.packageName ?? input.directory,
        directory: input.directory,
        language,
        metadataJson: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      });
      return toDto(row);
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
