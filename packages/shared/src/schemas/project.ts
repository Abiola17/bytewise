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
