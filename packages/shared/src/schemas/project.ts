import { z } from "zod";

/**
 * A project is registered by its directory name inside the server's
 * configured projects directory. Absolute paths are never accepted or returned.
 */
export const createProjectRequestSchema = z.object({
  directory: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, "Must be a single directory name, not a path")
    .refine((value) => value !== "." && value !== "..", "Must be a single directory name"),
  name: z.string().trim().min(1).max(100).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const projectMetadataSchema = z.object({
  packageName: z.string().nullable(),
  hasTypeScript: z.boolean(),
  scripts: z.array(z.string()),
});
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  language: z.string(),
  metadata: projectMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const availableProjectsResponseSchema = z.object({
  /** Directories inside the projects directory that are not yet registered. */
  directories: z.array(z.string()),
});
export type AvailableProjectsResponse = z.infer<typeof availableProjectsResponseSchema>;

/** Limits for importing a project from the browser (also enforced by the server). */
export const IMPORT_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
};

export const importProjectRequestSchema = z.object({
  /** Becomes the folder name inside the projects directory. */
  name: createProjectRequestSchema.shape.directory,
  files: z
    .array(
      z.object({
        /** Path inside the project, e.g. `src/index.js`. Validated again on the server. */
        path: z.string().min(1).max(1024),
        /** Base64 file content. */
        content: z.string(),
      }),
    )
    .min(1)
    .max(IMPORT_LIMITS.maxFiles),
});
export type ImportProjectRequest = z.infer<typeof importProjectRequestSchema>;

export const importProjectResponseSchema = z.object({
  project: projectSchema,
  importedFiles: z.number().int(),
  /** Files the server refused (first 50), with the reason. */
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type ImportProjectResponse = z.infer<typeof importProjectResponseSchema>;
