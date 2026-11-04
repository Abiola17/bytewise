import { z } from "zod";

export const dashboardSummarySchema = z.object({
  projects: z.number().int(),
  /** Diagnoses of kind "diagnosis" (not clarifying questions). */
  diagnoses: z.number().int(),
  sessions: z.object({
    total: z.number().int(),
    /** Sessions whose latest state is a fix verified by a passing run with the patch applied. */
    fixVerified: z.number().int(),
  }),
  verificationRuns: z.object({
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    timedOut: z.number().int(),
    error: z.number().int(),
    blocked: z.number().int(),
  }),
  patches: z.object({
    proposed: z.number().int(),
    applied: z.number().int(),
    rejected: z.number().int(),
  }),
  recentActivity: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["session_created", "diagnosis", "patch", "verification"]),
      /** Outcome of the event, e.g. a run or patch status, or a diagnosis kind. */
      status: z.string(),
      label: z.string(),
      sessionId: z.string(),
      sessionTitle: z.string(),
      projectName: z.string(),
      at: z.string().datetime(),
    }),
  ),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const testOutcomesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
  /** Client's offset from UTC in minutes (as returned by -Date#getTimezoneOffset()). */
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
});

export const testOutcomesSchema = z.object({
  days: z.array(
    z.object({
      /** Local calendar date, YYYY-MM-DD. */
      date: z.string(),
      passed: z.number().int(),
      failed: z.number().int(),
      timedOut: z.number().int(),
      error: z.number().int(),
    }),
  ),
  /** Total runs in the window that produced an outcome (blocked and running excluded). */
  totalRuns: z.number().int(),
});
export type TestOutcomes = z.infer<typeof testOutcomesSchema>;
