import { count, desc, eq, gte } from "drizzle-orm";
import type { DashboardSummary, TestOutcomes } from "@bytewise/shared";
import type { Db } from "../database/client";
import {
  debugSessions,
  diagnoses,
  patchProposals,
  projects,
  verificationRuns,
} from "../database/schema";

const RECENT_ACTIVITY_LIMIT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Aggregates stored records only; nothing here is estimated or sampled. */
export function createDashboardService(deps: { db: Db }) {
  const { db } = deps;

  function sessionInfo() {
    const rows = db
      .select({
        id: debugSessions.id,
        title: debugSessions.title,
        status: debugSessions.status,
        createdAt: debugSessions.createdAt,
        projectName: projects.name,
      })
      .from(debugSessions)
      .innerJoin(projects, eq(projects.id, debugSessions.projectId))
      .all();
    return new Map(rows.map((r) => [r.id, r]));
  }

  return {
    summary(): DashboardSummary {
      const sessions = sessionInfo();
      const runs = db
        .select({
          id: verificationRuns.id,
          sessionId: verificationRuns.sessionId,
          status: verificationRuns.status,
          commandLabel: verificationRuns.commandLabel,
          at: verificationRuns.startedAt,
          completedAt: verificationRuns.completedAt,
        })
        .from(verificationRuns)
        .all();
      const patches = db
        .select({
          id: patchProposals.id,
          sessionId: patchProposals.sessionId,
          status: patchProposals.status,
          createdAt: patchProposals.createdAt,
          appliedAt: patchProposals.appliedAt,
          rejectedAt: patchProposals.rejectedAt,
          revertedAt: patchProposals.revertedAt,
        })
        .from(patchProposals)
        .all();
      const recentDiagnoses = db
        .select({
          id: diagnoses.id,
          sessionId: diagnoses.sessionId,
          kind: diagnoses.kind,
          at: diagnoses.createdAt,
        })
        .from(diagnoses)
        .orderBy(desc(diagnoses.createdAt))
        .limit(RECENT_ACTIVITY_LIMIT)
        .all();

      const runsWith = (status: string) => runs.filter((r) => r.status === status).length;
      const projectCount = db.select({ n: count() }).from(projects).get()?.n ?? 0;
      const diagnosisCount =
        db.select({ n: count() }).from(diagnoses).where(eq(diagnoses.kind, "diagnosis")).get()?.n ??
        0;

      type Activity = DashboardSummary["recentActivity"][number];
      const activity: Array<Omit<Activity, "sessionTitle" | "projectName">> = [
        ...[...sessions.values()].map((s) => ({
          id: `session:${s.id}`,
          kind: "session_created" as const,
          status: "created",
          label: "Debugging session started",
          sessionId: s.id,
          at: s.createdAt,
        })),
        ...recentDiagnoses.map((d) => ({
          id: `diagnosis:${d.id}`,
          kind: "diagnosis" as const,
          status: d.kind,
          label: d.kind === "diagnosis" ? "Diagnosis proposed" : "More information requested",
          sessionId: d.sessionId,
          at: d.at,
        })),
        ...patches.map((p) => ({
          id: `patch:${p.id}`,
          kind: "patch" as const,
          status: p.status,
          label: `Patch ${p.status}`,
          sessionId: p.sessionId,
          at: p.revertedAt ?? p.appliedAt ?? p.rejectedAt ?? p.createdAt,
        })),
        ...runs.map((r) => ({
          id: `run:${r.id}`,
          kind: "verification" as const,
          status: r.status,
          label: r.commandLabel,
          sessionId: r.sessionId,
          at: r.completedAt ?? r.at,
        })),
      ];

      return {
        projects: projectCount,
        diagnoses: diagnosisCount,
        sessions: {
          total: sessions.size,
          fixVerified: [...sessions.values()].filter((s) => s.status === "fix_verified").length,
        },
        verificationRuns: {
          total: runs.length,
          passed: runsWith("passed"),
          failed: runsWith("failed"),
          timedOut: runsWith("timed_out"),
          error: runsWith("error"),
          blocked: runsWith("blocked"),
        },
        patches: {
          proposed: patches.length,
          applied: patches.filter((p) => p.appliedAt !== null).length,
          rejected: patches.filter((p) => p.status === "rejected").length,
        },
        recentActivity: activity
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, RECENT_ACTIVITY_LIMIT)
          .map((a) => {
            const session = sessions.get(a.sessionId);
            return {
              ...a,
              sessionTitle: session?.title ?? "Unknown session",
              projectName: session?.projectName ?? "Unknown project",
            };
          }),
      };
    },

    /** Per-day run outcomes for the last `days` local days (including today). */
    testOutcomes(days: number, tzOffsetMinutes: number, now = new Date()): TestOutcomes {
      const offsetMs = tzOffsetMinutes * 60 * 1000;
      const localDate = (iso: string) =>
        new Date(new Date(iso).getTime() + offsetMs).toISOString().slice(0, 10);

      const todayLocal = localDate(now.toISOString());
      const dates = Array.from({ length: days }, (_, i) =>
        new Date(Date.parse(`${todayLocal}T00:00:00Z`) - (days - 1 - i) * DAY_MS)
          .toISOString()
          .slice(0, 10),
      );
      // Start of the first local day, expressed in UTC.
      const cutoff = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - offsetMs).toISOString();

      const buckets = new Map(
        dates.map((date) => [date, { date, passed: 0, failed: 0, timedOut: 0, error: 0 }]),
      );
      const rows = db
        .select({ status: verificationRuns.status, startedAt: verificationRuns.startedAt })
        .from(verificationRuns)
        .where(gte(verificationRuns.startedAt, cutoff))
        .all();

      let totalRuns = 0;
      for (const row of rows) {
        const bucket = buckets.get(localDate(row.startedAt));
        if (!bucket) continue;
        if (row.status === "passed") bucket.passed++;
        else if (row.status === "failed") bucket.failed++;
        else if (row.status === "timed_out") bucket.timedOut++;
        else if (row.status === "error") bucket.error++;
        else continue; // blocked (nothing ran) and running (no outcome yet)
        totalRuns++;
      }
      return { days: [...buckets.values()], totalRuns };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
