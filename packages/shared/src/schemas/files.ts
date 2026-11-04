import { z } from "zod";

/** Project-relative POSIX path, e.g. `src/routes/login.js`. Never absolute. */
export const relativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p), "Must be a relative path")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "Must not contain '..'")
  .refine((p) => !p.includes("\0"), "Must not contain NUL bytes");

export const projectFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});
export type ProjectFile = z.infer<typeof projectFileSchema>;

export const fileListResponseSchema = z.object({
  files: z.array(projectFileSchema),
  /** True when discovery stopped at a limit and the list is incomplete. */
  truncated: z.boolean(),
});
export type FileListResponse = z.infer<typeof fileListResponseSchema>;

export const fileContentQuerySchema = z.object({ path: relativePathSchema });

export const fileContentResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  language: z.string(),
});
export type FileContentResponse = z.infer<typeof fileContentResponseSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const searchMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string(),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

export const searchResponseSchema = z.object({
  matches: z.array(searchMatchSchema),
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
