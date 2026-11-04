import { z } from "zod";

/**
 * `running` is transient. Final states:
 * - passed:    the process exited with code 0
 * - failed:    the process exited with a non-zero code
 * - timed_out: the process was killed at the time limit
 * - blocked:   the command is not permitted by the execution policy (nothing ran)
 * - error:     the process could not be started or the run was interrupted
 */
export const VERIFICATION_STATUSES = [
  "running",
  "passed",
  "failed",
  "timed_out",
  "blocked",
  "error",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const verificationCommandSchema = z.object({
  script: z.string(),
  /** What is executed, e.g. `npm run test`. */
  label: z.string(),
  /** The script body from package.json, shown so the developer knows what runs. */
  definition: z.string(),
});
export type VerificationCommand = z.infer<typeof verificationCommandSchema>;

export const verificationRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  patchId: z.string().nullable(),
  script: z.string(),
  commandLabel: z.string(),
  status: z.enum(VERIFICATION_STATUSES),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type VerificationRun = z.infer<typeof verificationRunSchema>;

export const startVerificationRequestSchema = z.object({
  script: z.string().min(1).max(64),
});
export type StartVerificationRequest = z.infer<typeof startVerificationRequestSchema>;
