import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectListResponseSchema, projectSchema } from "@bytewise/shared";
import { createTestApp } from "./helpers";

describe("projects API", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  function makeProject(dir: string, pkg?: object, withTsconfig = false) {
    const root = path.join(ctx.projectsDir, dir);
    fs.mkdirSync(root);
    if (pkg) fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    if (withTsconfig) fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
    return root;
  }

  it("registers a project and reads its metadata", async () => {
    makeProject(
      "demo",
      { name: "demo-app", scripts: { test: "vitest", build: "tsc" }, devDependencies: {} },
      true,
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { directory: "demo" },
    });

    expect(res.statusCode).toBe(201);
    const project = projectSchema.parse(res.json());
    expect(project).toMatchObject({
      name: "demo-app",
      directory: "demo",
      language: "typescript",
      metadata: { packageName: "demo-app", hasTypeScript: true, scripts: ["test", "build"] },
    });
    expect(res.body).not.toContain(ctx.projectsDir);

    const list = projectListResponseSchema.parse(
      (await ctx.app.inject({ method: "GET", url: "/api/v1/projects" })).json(),
    );
    expect(list.projects.map((p) => p.id)).toEqual([project.id]);

    const fetched = await ctx.app.inject({ method: "GET", url: `/api/v1/projects/${project.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(project);
  });

  it("rejects duplicate registration", async () => {
    makeProject("demo", { name: "demo" });
    const payload = { directory: "demo" };
    await ctx.app.inject({ method: "POST", url: "/api/v1/projects", payload });
    const res = await ctx.app.inject({ method: "POST", url: "/api/v1/projects", payload });
    expect(res.statusCode).toBe(409);
  });

  it.each(["../etc", "..", "a/b", "/etc", "."])("rejects path-like directory %j", async (dir) => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { directory: dir },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("rejects a symlink that points outside the projects directory", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-outside-"));
    fs.symlinkSync(outside, path.join(ctx.projectsDir, "escape"));
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: { directory: "escape" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns 404 for a missing directory or project", async () => {
    const missingDir = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { directory: "missing" },
    });
    expect(missingDir.statusCode).toBe(404);

    const missingProject = await ctx.app.inject({ method: "GET", url: "/api/v1/projects/nope" });
    expect(missingProject.statusCode).toBe(404);
    expect(missingProject.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
