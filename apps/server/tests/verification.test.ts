import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionDetailSchema, verificationRunSchema, type VerificationRun } from "@bytewise/shared";
import { REPO_ROOT } from "../src/config/env";
import type { ModelProvider, StructuredRequest } from "../src/providers/model-provider";
import { createTestApp } from "./helpers";

const DEMO_APP = path.join(REPO_ROOT, "examples/broken-login-app");
const SESSION_FILE = "src/services/session.js";

function provider() {
  const diagnosisRequests: StructuredRequest[] = [];
  const p: ModelProvider = {
    name: "test",
    model: "test-model",
    async generateStructured(request) {
      if (request.schema.name === "bytewise_diagnosis") {
        diagnosisRequests.push(request);
        return {
          model: "test-model",
          usage: null,
          content: JSON.stringify({
            kind: "diagnosis",
            reply: "Config key mismatch.",
            summary: "Token signing uses an undefined secret.",
            likelyCause: "session.js reads config.secret.",
            confidence: "high",
            uncertainty: null,
            suggestedFix: "Use config.sessionSecret.",
            evidenceIds: [],
            limitations: [],
            clarifyingQuestions: [],
          }),
        };
      }
      return {
        model: "test-model",
        usage: null,
        content: JSON.stringify({
          canPropose: true,
          reasonIfNot: null,
          explanation: "Use the configured secret name.",
          changes: [
            {
              path: SESSION_FILE,
              summary: "Read sessionSecret.",
              edits: [{ find: "config.secret)", replace: "config.sessionSecret)" }],
            },
          ],
        }),
      };
    },
  };
  return { provider: p, diagnosisRequests };
}

describe("verification runs", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  afterEach(async () => {
    await ctx?.cleanup();
  });

  async function setup() {
    const scripted = provider();
    ctx = await createTestApp({ modelProvider: scripted.provider });
    fs.cpSync(DEMO_APP, path.join(ctx.projectsDir, "broken-login-app"), { recursive: true });
    const project = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: { directory: "broken-login-app" },
      })
    ).json();
    const sessionId = (
      await ctx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/sessions`,
        payload: {},
      })
    ).json().id as string;
    return { sessionId, ...scripted };
  }

  const start = (sessionId: string, script: string) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/verifications`,
      payload: { script },
    });

  async function waitFor(runId: string): Promise<VerificationRun> {
    for (let i = 0; i < 300; i++) {
      const run = verificationRunSchema.parse(
        (await ctx.app.inject({ method: "GET", url: `/api/v1/verifications/${runId}` })).json(),
      );
      if (run.status !== "running") return run;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("run did not finish");
  }

  const detail = async (sessionId: string) =>
    sessionDetailSchema.parse(
      (await ctx.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}` })).json(),
    );

  it("lists the allowed commands in the session detail", async () => {
    const { sessionId } = await setup();
    expect((await detail(sessionId)).verificationCommands).toEqual([
      { script: "test", label: "npm run test", definition: "node --test" },
    ]);
  });

  it("runs the real test suite: fails before the fix, passes after it", async () => {
    const { sessionId, diagnosisRequests } = await setup();

    // Baseline: the demo bug makes two tests fail.
    const started = await start(sessionId, "test");
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ status: "running", commandLabel: "npm run test" });
    const baseline = await waitFor(started.json().id);
    expect(baseline).toMatchObject({ status: "failed", exitCode: 1, patchId: null });
    expect(baseline.stdout).toMatch(/fail 2/);
    expect(baseline.durationMs).toBeGreaterThan(0);

    // The failing output becomes evidence for the next diagnosis.
    await ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/messages`,
      payload: { content: "The tests are failing, investigate." },
    });
    const prompt = diagnosisRequests[0]!.messages[1]!.content;
    expect(prompt).toMatch(
      /<evidence id="ev_[0-9a-f]+" type="test_output" path="verification: npm run test"/,
    );
    expect(prompt).toContain("ERR_INVALID_ARG_TYPE");

    // Propose + apply the fix, then verify.
    const patch = (
      await ctx.app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/patch-proposals` })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/v1/patches/${patch.id}/approve` });

    const after = await waitFor((await start(sessionId, "test")).json().id);
    expect(after).toMatchObject({ status: "passed", exitCode: 0, patchId: patch.id });
    expect(after.stdout).toMatch(/fail 0/);

    const final = await detail(sessionId);
    expect(final.session.status).toBe("fix_verified");
    expect(final.verifications.map((v) => v.status)).toEqual(["failed", "passed"]);
  });

  it("marks verification_failed when tests fail with a patch applied", async () => {
    const { sessionId } = await setup();
    await ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/messages`,
      payload: { content: "Login fails with 500" },
    });
    const patch = (
      await ctx.app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/patch-proposals` })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/v1/patches/${patch.id}/approve` });
    // Break the project in another way after the patch.
    const root = path.join(ctx.projectsDir, "broken-login-app");
    fs.writeFileSync(path.join(root, "src/config.js"), "export const config = {};\n");

    const run = await waitFor((await start(sessionId, "test")).json().id);
    expect(run.status).toBe("failed");
    expect((await detail(sessionId)).session.status).toBe("verification_failed");
  });

  it.each(["start", "dev", "deploy", "typecheck", "test && rm -rf /"])(
    "records %j as blocked without running anything",
    async (script) => {
      const { sessionId } = await setup();
      const res = await start(sessionId, script);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "blocked", exitCode: null, stdout: "" });
      expect(res.json().errorMessage).toBeTruthy();
    },
  );

  it("refuses a second concurrent run for the same project", async () => {
    const { sessionId } = await setup();
    const first = await start(sessionId, "test");
    const second = await start(sessionId, "test");
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: "verification_in_progress" } });
    await waitFor(first.json().id);
  });

  it("times out long-running commands", async () => {
    const scripted = provider();
    ctx = await createTestApp(
      { modelProvider: scripted.provider },
      { VERIFICATION_TIMEOUT_MS: "1000" },
    );
    const root = path.join(ctx.projectsDir, "slow");
    fs.mkdirSync(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "slow", scripts: { test: 'node -e "setInterval(()=>{},1000)"' } }),
    );
    const project = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: { directory: "slow" },
      })
    ).json();
    const sessionId = (
      await ctx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/sessions`,
        payload: {},
      })
    ).json().id;

    const run = await waitFor((await start(sessionId, "test")).json().id);
    expect(run.status).toBe("timed_out");
    expect(run.errorMessage).toMatch(/time limit/);
  });

  it("returns 404 for unknown runs", async () => {
    await setup();
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/v1/verifications/nope" })).statusCode,
    ).toBe(404);
  });
});
