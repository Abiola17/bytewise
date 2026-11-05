import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { patchProposalSchema, sessionDetailSchema } from "@bytewise/shared";
import { REPO_ROOT } from "../src/config/env";
import type { ModelProvider, StructuredRequest } from "../src/providers/model-provider";
import { createTestApp } from "./helpers";

const DEMO_APP = path.join(REPO_ROOT, "examples/broken-login-app");
const SESSION_FILE = "src/services/session.js";
const BUGGY = 'createHmac("sha256", config.secret)';
const FIXED = 'createHmac("sha256", config.sessionSecret)';

type Script = Array<string | ((req: StructuredRequest) => string)>;

/** Test double: answers diagnosis requests with a fixed diagnosis, patch requests from a script. */
function provider(patchScript: Script) {
  const patchRequests: StructuredRequest[] = [];
  const p: ModelProvider = {
    name: "test",
    model: "test-model",
    async generateStructured(request) {
      if (request.schema.name === "bytewise_diagnosis") {
        const ids = [
          ...String(request.messages[1]!.content).matchAll(
            /<evidence id="(ev_[0-9a-f]+)"[^>]*path="src\/services\/session\.js"/g,
          ),
        ].map((m) => m[1]);
        return {
          model: "test-model",
          usage: null,
          content: JSON.stringify({
            kind: "diagnosis",
            reply: "Config key mismatch.",
            summary: "Token signing uses an undefined secret.",
            likelyCause: "session.js reads config.secret; config defines sessionSecret.",
            confidence: "high",
            uncertainty: null,
            suggestedFix: "Use config.sessionSecret.",
            evidenceIds: ids,
            limitations: [],
            clarifyingQuestions: [],
          }),
        };
      }
      patchRequests.push(request);
      const next = patchScript.shift();
      if (next === undefined) throw new Error("no scripted patch response left");
      return {
        model: "test-model",
        usage: null,
        content: typeof next === "function" ? next(request) : next,
      };
    },
  };
  return { provider: p, patchRequests };
}

const patchJson = (changes: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    canPropose: true,
    reasonIfNot: null,
    explanation: "Use the configured secret name.",
    changes,
    ...extra,
  });

const goodPatch = patchJson([
  { path: SESSION_FILE, summary: "Read sessionSecret.", edits: [{ find: BUGGY, replace: FIXED }] },
]);

describe("patch workflow", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let projectRoot: string;

  afterEach(async () => {
    await ctx?.cleanup();
  });

  async function setup(script: Script) {
    const scripted = provider(script);
    ctx = await createTestApp({ modelProvider: scripted.provider });
    projectRoot = path.join(ctx.projectsDir, "broken-login-app");
    fs.cpSync(DEMO_APP, projectRoot, { recursive: true });
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
    const diagnosed = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/messages`,
      payload: { content: "The login endpoint returns 500 for valid credentials." },
    });
    expect(diagnosed.statusCode).toBe(200);
    return { sessionId, ...scripted };
  }

  const read = (rel: string) => fs.readFileSync(path.join(projectRoot, rel), "utf8");
  const post = (url: string) => ctx.app.inject({ method: "POST", url });
  const propose = (sessionId: string) => post(`/api/v1/sessions/${sessionId}/patch-proposals`);

  it("proposes a patch without touching files, then applies it only on approval", async () => {
    const { sessionId, patchRequests } = await setup([goodPatch]);
    const before = read(SESSION_FILE);

    const proposed = await propose(sessionId);
    expect(proposed.statusCode).toBe(201);
    const patch = patchProposalSchema.parse(proposed.json());
    expect(patch.status).toBe("proposed");
    expect(patch.files).toHaveLength(1);
    expect(patch.files[0]).toMatchObject({ path: SESSION_FILE, additions: 1, deletions: 1 });
    expect(patch.files[0]!.diff).toContain(`+  const signature = ${FIXED}`);
    expect(read(SESSION_FILE)).toBe(before); // proposing changes nothing

    // The model saw the full file and was told tests/package.json are off-limits.
    const prompt = patchRequests[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain(`<file path="${SESSION_FILE}">`);
    expect(prompt).not.toContain('<file path="test/');
    expect(prompt).toMatch(/Never edit test files/);

    const approved = await post(`/api/v1/patches/${patch.id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(patchProposalSchema.parse(approved.json())).toMatchObject({ status: "applied" });
    expect(read(SESSION_FILE)).toBe(before.replace(BUGGY, FIXED));
    expect(fs.readdirSync(path.dirname(path.join(projectRoot, SESSION_FILE)))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/bytewise-.*\.tmp$/)]),
    );

    const detail = sessionDetailSchema.parse(
      (await ctx.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}` })).json(),
    );
    expect(detail.session.status).toBe("patch_applied");

    // The demo's own test suite now passes against the patched project.
    const output = execFileSync(process.execPath, ["--test"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toMatch(/# fail 0|ℹ fail 0/);
  });

  it("cannot apply the same patch twice", async () => {
    const { sessionId } = await setup([goodPatch]);
    const patch = (await propose(sessionId)).json();
    expect((await post(`/api/v1/patches/${patch.id}/approve`)).statusCode).toBe(200);
    const again = await post(`/api/v1/patches/${patch.id}/approve`);
    expect(again.statusCode).toBe(409);
  });

  it("rejecting leaves every file unchanged", async () => {
    const { sessionId } = await setup([goodPatch]);
    const before = read(SESSION_FILE);
    const patch = (await propose(sessionId)).json();

    const rejected = await post(`/api/v1/patches/${patch.id}/reject`);
    expect(rejected.json()).toMatchObject({ status: "rejected" });
    expect(read(SESSION_FILE)).toBe(before);
    expect((await post(`/api/v1/patches/${patch.id}/approve`)).statusCode).toBe(409);
  });

  it("refuses to apply when the file changed after the proposal", async () => {
    const { sessionId } = await setup([goodPatch]);
    const patch = (await propose(sessionId)).json();
    const edited = read(SESSION_FILE) + "\n// edited by the developer\n";
    fs.writeFileSync(path.join(projectRoot, SESSION_FILE), edited);

    const res = await post(`/api/v1/patches/${patch.id}/approve`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "patch_stale" } });
    expect(read(SESSION_FILE)).toBe(edited);

    const stored = (
      await ctx.app.inject({ method: "GET", url: `/api/v1/patches/${patch.id}` })
    ).json();
    expect(stored).toMatchObject({ status: "failed" });
    expect(stored.applicationResult).toMatch(/changed after the patch was proposed/);
  });

  it("reverts an applied patch", async () => {
    const { sessionId } = await setup([goodPatch]);
    const before = read(SESSION_FILE);
    const patch = (await propose(sessionId)).json();
    await post(`/api/v1/patches/${patch.id}/approve`);

    const reverted = await post(`/api/v1/patches/${patch.id}/revert`);
    expect(reverted.json()).toMatchObject({ status: "reverted" });
    expect(read(SESSION_FILE)).toBe(before);
  });

  it("supersedes an older open proposal", async () => {
    const { sessionId } = await setup([goodPatch, goodPatch]);
    const first = (await propose(sessionId)).json();
    await propose(sessionId);
    const stored = (
      await ctx.app.inject({ method: "GET", url: `/api/v1/patches/${first.id}` })
    ).json();
    expect(stored.status).toBe("superseded");
  });

  it("retries with feedback, then rejects patches that break policy", async () => {
    const testEdit = patchJson([
      {
        path: "test/login.test.js",
        summary: "",
        edits: [{ find: "assert.equal(result.status, 200);", replace: "" }],
      },
    ]);
    const escape = patchJson([
      { path: "../../.env", summary: "", edits: [{ find: "a", replace: "b" }] },
    ]);
    const { sessionId, patchRequests } = await setup([testEdit, escape]);
    const before = read("test/login.test.js");

    const res = await propose(sessionId);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: "patch_invalid" } });
    expect(patchRequests).toHaveLength(2);
    expect(patchRequests[1]!.messages.at(-1)!.content).toMatch(/test files cannot be modified/);
    expect(read("test/login.test.js")).toBe(before);
  });

  it("recovers when the retry fixes an ambiguous edit", async () => {
    const ambiguous = patchJson([
      { path: SESSION_FILE, summary: "", edits: [{ find: "config", replace: "cfg" }] },
    ]);
    const { sessionId } = await setup([ambiguous, goodPatch]);
    expect((await propose(sessionId)).statusCode).toBe(201);
  });

  it("reports when the model declines to propose a patch", async () => {
    const { sessionId } = await setup([
      patchJson([], { canPropose: false, reasonIfNot: "Need the config file." }),
    ]);
    const res = await propose(sessionId);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/Need the config file/);
  });

  it("returns 404 for unknown patches", async () => {
    await setup([]);
    expect((await post(`/api/v1/patches/nope/approve`)).statusCode).toBe(404);
  });
});
