import { z } from "zod";
import { evidenceItemSchema } from "./evidence";
import { patchProposalSchema } from "./patch";
import { screenshotSchema } from "./media";
import { verificationCommandSchema, verificationRunSchema } from "./verification";

export const SESSION_STATUSES = [
  "open",
  "diagnosed",
  "needs_information",
  "patch_proposed",
  "patch_applied",
  "fix_verified",
  "verification_failed",
  "closed",
] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const debugSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.enum(SESSION_STATUSES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DebugSession = z.infer<typeof debugSessionSchema>;

export const messageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  diagnosisId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;

/**
 * An AI hypothesis grounded in stored evidence. `kind` is
 * `needs_information` when the model could not support a diagnosis and asks
 * clarifying questions instead.
 */
export const diagnosisSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: z.enum(["diagnosis", "needs_information"]),
  summary: z.string(),
  likelyCause: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS).nullable(),
  uncertainty: z.string().nullable(),
  suggestedFix: z.string().nullable(),
  limitations: z.array(z.string()),
  clarifyingQuestions: z.array(z.string()),
  /** Ids of stored evidence items the diagnosis relies on. */
  evidenceIds: z.array(z.string()),
  /** Ids the model cited that did not match any provided evidence (discarded). */
  rejectedEvidenceIds: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
  createdAt: z.string().datetime(),
});
export type Diagnosis = z.infer<typeof diagnosisSchema>;

export const createSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionListResponseSchema = z.object({
  sessions: z.array(debugSessionSchema.extend({ projectName: z.string() })),
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const sessionDetailSchema = z.object({
  session: debugSessionSchema,
  project: z.object({ id: z.string(), name: z.string() }),
  messages: z.array(messageSchema),
  evidence: z.array(evidenceItemSchema.omit({ score: true })),
  diagnoses: z.array(diagnosisSchema),
  patches: z.array(patchProposalSchema),
  verifications: z.array(verificationRunSchema),
  /** Commands the execution policy allows for this project, read from package.json. */
  verificationCommands: z.array(verificationCommandSchema),
  screenshots: z.array(screenshotSchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export const postMessageRequestSchema = z.object({
  content: z.string().trim().min(3).max(8000),
});
export type PostMessageRequest = z.infer<typeof postMessageRequestSchema>;
