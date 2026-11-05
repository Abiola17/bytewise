import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidenceResponseSchema } from "@bytewise/shared";
import { REPO_ROOT } from "../src/config/env";
import { CONTEXT_BUDGET, extractTerms } from "../src/services/context.service";
import { createTestApp } from "./helpers";

const DEMO_APP = path.join(REPO_ROOT, "examples/broken-login-app");

describe("extractTerms", () => {
  it("keeps meaningful words, code identifiers and status codes", () => {
    const terms = extractTerms("The login endpoint returns a 500 when `createSessionToken` runs");
    const texts = terms.map((t) => t.text);
    expect(texts).toEqual(
      expect.arrayContaining(["login", "endpoint", "500", "createSessionToken"]),
    );
    expect(texts).not.toContain("the");
    expect(texts).not.toContain("returns");
  });

  it("splits dotted member access", () => {
    const texts = extractTerms("config.secret is undefined").map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(["config.secret", "config", "secret"]));
  });
});

describe("POST /projects/:id/evidence on the demo app", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let projectId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    fs.cpSync(DEMO_APP, path.join(ctx.projectsDir, "broken-login-app"), { recursive: true });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { directory: "broken-login-app" },
    });
    projectId = res.json().id;
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  const evidenceFor = async (query: string) => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/evidence`,
      payload: { query },
    });
    expect(res.statusCode).toBe(200);
    return evidenceResponseSchema.parse(res.json());
  };

  it("reaches the session and config modules from a plain-language bug report", async () => {
    const result = await evidenceFor(
      "The login endpoint returns a 500 error when a user submits valid credentials.",
    );
    const paths = result.evidence.map((e) => e.relativePath);
    expect(paths).toContain("src/routes/login.js");
    expect(paths).toContain("src/services/session.js");
    expect(paths).toContain("src/config.js");
  });

  it("always includes the package.json scripts, so run questions are answerable", async () => {
    const result = await evidenceFor("How do I view this project?");
    const scripts = result.evidence.find(
      (e) => e.relativePath === "package.json" && e.excerpt.includes('"scripts"'),
    );
    expect(scripts).toBeDefined();
    expect(scripts!.excerpt).toContain('"test"');
  });

  it("puts stack-trace locations first", async () => {
    const result = await evidenceFor(
      "TypeError [ERR_INVALID_ARG_TYPE]: Received undefined\n" +
        "    at createSessionToken (file:///srv/broken-login-app/src/services/session.js:14:21)",
    );
    const first = result.evidence[0]!;
    expect(first).toMatchObject({
      sourceType: "stack_trace_location",
      relativePath: "src/services/session.js",
    });
    expect(first.startLine).toBeLessThanOrEqual(14);
    expect(first.endLine).toBeGreaterThanOrEqual(14);
    // Modules imported by the stack-trace file are followed (config.js defines the secret).
    expect(result.evidence.map((e) => e.relativePath)).toContain("src/config.js");
  });

  it("returns excerpts that match the real file contents and respects the budget", async () => {
    const result = await evidenceFor("login session token config secret user password");
    // Code evidence fills at most maxItems; the small package.json scripts block rides on top.
    const code = result.evidence.filter(
      (e) => !e.reason.startsWith("The project's package.json scripts"),
    );
    expect(code.length).toBeLessThanOrEqual(CONTEXT_BUDGET.maxItems);
    expect(result.evidence.length - code.length).toBeLessThanOrEqual(1);
    expect(result.budget.usedChars).toBeLessThanOrEqual(CONTEXT_BUDGET.maxTotalChars);

    for (const item of result.evidence) {
      const lines = fs
        .readFileSync(path.join(DEMO_APP, item.relativePath), "utf8")
        .split(/\r?\n/)
        .slice(item.startLine - 1, item.endLine)
        .join("\n");
      expect(item.excerpt).toBe(lines);
    }
  });

  it("rejects a query that is too short", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/evidence`,
      payload: { query: "x" },
    });
    expect(res.statusCode).toBe(400);
  });
});
