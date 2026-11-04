import { z } from "zod";

/**
 * Lifecycle (enforced by the backend):
 *   proposed → applied | rejected | failed | superseded
 *   applied  → reverted
 */
export const PATCH_STATUSES = [
  "proposed",
  "applied",
  "rejected",
  "failed",
  "superseded",
  "reverted",
] as const;
export type PatchStatus = (typeof PATCH_STATUSES)[number];

export const patchFileSchema = z.object({
  path: z.string(),
  summary: z.string(),
  /** Full file content the patch was generated against. */
  originalContent: z.string(),
  /** Full file content after applying the patch. */
  proposedContent: z.string(),
  /** Unified diff, for display and the record. */
  diff: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type PatchFile = z.infer<typeof patchFileSchema>;

export const patchProposalSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  diagnosisId: z.string(),
  status: z.enum(PATCH_STATUSES),
  explanation: z.string(),
  files: z.array(patchFileSchema),
  provider: z.string(),
  model: z.string(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  appliedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  revertedAt: z.string().datetime().nullable(),
  /** Human-readable outcome of the last apply/revert attempt, e.g. why it failed. */
  applicationResult: z.string().nullable(),
});
export type PatchProposal = z.infer<typeof patchProposalSchema>;
