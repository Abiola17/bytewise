import { z } from "zod";

export const EVIDENCE_SOURCE_TYPES = [
  "source_file",
  "test_file",
  "config_file",
  "stack_trace_location",
  "test_output",
  "screenshot_regions",
] as const;

/**
 * Observed evidence: content read directly from the project. Never produced by
 * the model — the model may only reference evidence by `id`.
 */
export const evidenceItemSchema = z.object({
  id: z.string(),
  sourceType: z.enum(EVIDENCE_SOURCE_TYPES),
  /** Project-relative file path; for `test_output`, a label like "verification: npm run test". */
  relativePath: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: z.string(),
  /** Why the context engine selected this item (search terms matched, etc.). */
  reason: z.string(),
  score: z.number(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const evidenceRequestSchema = z.object({
  query: z.string().trim().min(3).max(4000),
});
export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;

export const evidenceResponseSchema = z.object({
  evidence: z.array(evidenceItemSchema),
  terms: z.array(z.string()),
  budget: z.object({
    maxItems: z.number().int(),
    maxTotalChars: z.number().int(),
    usedChars: z.number().int(),
    /** Candidate excerpts dropped because a budget was reached. */
    droppedItems: z.number().int(),
  }),
});
export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;
