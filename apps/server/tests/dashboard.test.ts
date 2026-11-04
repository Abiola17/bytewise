import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dashboardSummarySchema, testOutcomesSchema } from "@bytewise/shared";
import { openDatabase, type DatabaseHandle } from "../src/database/client";
import { debugSessions, projects, verificationRuns } from "../src/database/schema";
import { createDashboardService } from "../src/services/dashboard.service";
import { createTestApp } from "./helpers";

describe("dashboard API", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns zeroed metrics and empty days when there is no history", async () => {
    const summary = dashboardSummarySchema.parse(
      (await ctx.app.inject({ method: "GET", url: "/api/v1/dashboard/summary" })).json(),
    );
    expect(summary.sessions).toEqual({ total: 0, fixVerified: 0 });
    expect(summary.verificationRuns.total).toBe(0);
    expect(summary.recentActivity).toEqual([]);

    const outcomes = testOutcomesSchema.parse(
      (
        await ctx.app.inject({ method: "GET", url: "/api/v1/dashboard/test-outcomes?days=7" })
      ).json(),
    );
    expect(outcomes.days).toHaveLength(7);
    expect(outcomes.totalRuns).toBe(0);
  });

  it("validates query parameters", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/dashboard/test-outcomes?days=0",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("dashboard aggregation", () => {
  let handle: DatabaseHandle;
  beforeEach(() => {
    handle = openDatabase(":memory:");
    const { db } = handle;
    db.insert(projects)
      .values({
        id: "p1",
        name: "demo",
        directory: "demo",
        language: "javascript",
        metadataJson: "{}",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      })
      .run();
    db.insert(debugSessions)
      .values([
        {
          id: "s1",
          projectId: "p1",
          title: "A",
          status: "fix_verified",
          createdAt: "2026-11-02T10:00:00.000Z",
          updatedAt: "2026-11-02T10:00:00.000Z",
        },
        {
          id: "s2",
          projectId: "p1",
          title: "B",
          status: "diagnosed",
          createdAt: "2026-11-03T10:00:00.000Z",
          updatedAt: "2026-11-03T10:00:00.000Z",
        },
      ])
      .run();
    const run = (id: string, status: string, startedAt: string) => ({
      id,
      sessionId: "s1",
      patchId: null,
      script: "test",
      commandLabel: "npm run test",
      status,
      exitCode: status === "passed" ? 0 : 1,
      signal: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      errorMessage: null,
      durationMs: 10,
      startedAt,
      completedAt: startedAt,
    });
    db.insert(verificationRuns)
      .values([
        run("r1", "failed", "2026-11-03T23:30:00.000Z"),
        run("r2", "passed", "2026-11-04T00:30:00.000Z"),
        run("r3", "timed_out", "2026-11-04T12:00:00.000Z"),
        run("r4", "blocked", "2026-11-04T12:00:00.000Z"),
        run("r5", "running", "2026-11-04T12:30:00.000Z"),
        run("r6", "passed", "2026-10-01T12:00:00.000Z"), // outside the window
      ])
      .run();
  });
  afterEach(() => handle.close());

  it("counts sessions and runs from stored records", () => {
    const summary = createDashboardService({ db: handle.db }).summary();
    expect(summary.sessions).toEqual({ total: 2, fixVerified: 1 });
    expect(summary.verificationRuns).toEqual({
      total: 6,
      passed: 2,
      failed: 1,
      timedOut: 1,
      error: 0,
      blocked: 1,
    });
    expect(summary.recentActivity[0]).toMatchObject({ sessionTitle: "A", projectName: "demo" });
  });

  it("buckets runs by the client's local day and skips runs without an outcome", () => {
    const service = createDashboardService({ db: handle.db });
    const now = new Date("2026-11-04T15:00:00.000Z");

    const utc = service.testOutcomes(3, 0, now);
    expect(utc.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(utc.days[1]).toMatchObject({ failed: 1, passed: 0 });
    expect(utc.days[2]).toMatchObject({ passed: 1, timedOut: 1 });
    expect(utc.totalRuns).toBe(3); // blocked, running and out-of-window runs excluded

    // UTC+1: the 23:30Z failure on Nov 3 belongs to Nov 4 locally.
    const plusOne = service.testOutcomes(3, 60, now);
    expect(plusOne.days[2]).toMatchObject({ failed: 1, passed: 1, timedOut: 1 });
  });
});
