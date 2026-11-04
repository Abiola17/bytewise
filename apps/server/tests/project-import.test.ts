import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importProjectResponseSchema, sessionDetailSchema } from "@bytewise/shared";
import { createTestApp } from "./helpers";

const b64 = (text: string) => Buffer.from(text).toString("base64");
const pkg = JSON.stringify({ name: "uploaded-app", scripts: { test: "node --test" } });

describe("POST /projects/import", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  const importProject = (payload: object) =>
    ctx.app.inject({ method: "POST", url: "/api/v1/projects/import", payload });

  it("creates the folder, registers the project and skips what it must not store", async () => {
    const res = await importProject({
      name: "uploaded-app",
      files: [
        { path: "package.json", content: b64(pkg) },
        { path: "src/index.js", content: b64("export const x = 1;\n") },
        { path: "test/index.test.js", content: b64("import 'node:test';\n") },
        { path: ".env", content: b64("SECRET=shh") },
        { path: "node_modules/lib/index.js", content: b64("x") },
        { path: "logo.png", content: b64("png") },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = importProjectResponseSchema.parse(res.json());
    expect(body.project).toMatchObject({ name: "uploaded-app", directory: "uploaded-app" });
    expect(body.importedFiles).toBe(3);
    expect(body.skipped.map((s) => s.path).sort()).toEqual([
      ".env",
      "logo.png",
      "node_modules/lib/index.js",
    ]);

    const root = path.join(ctx.projectsDir, "uploaded-app");
    expect(fs.readFileSync(path.join(root, "src/index.js"), "utf8")).toBe("export const x = 1;\n");
    expect(fs.existsSync(path.join(root, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
    // No staging folders left behind.
    expect(fs.readdirSync(ctx.projectsDir)).toEqual(["uploaded-app"]);

    // The imported project works like any other: its test script is runnable.
    const session = (
      await ctx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${body.project.id}/sessions`,
        payload: {},
      })
    ).json();
    const detail = sessionDetailSchema.parse(
      (await ctx.app.inject({ method: "GET", url: `/api/v1/sessions/${session.id}` })).json(),
    );
    expect(detail.verificationCommands.map((c) => c.script)).toEqual(["test"]);
  });

  it("never writes outside the new project folder", async () => {
    const res = await importProject({
      name: "evil",
      files: [
        { path: "package.json", content: b64(pkg) },
        { path: "../escaped.js", content: b64("x") },
        { path: "/etc/passwd", content: b64("x") },
        { path: "src/../../escaped2.js", content: b64("x") },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().importedFiles).toBe(1);
    expect(res.json().skipped).toHaveLength(3);
    expect(fs.existsSync(path.join(ctx.projectsDir, "escaped.js"))).toBe(false);
    expect(fs.existsSync(path.join(ctx.projectsDir, "..", "escaped.js"))).toBe(false);
  });

  it("refuses to overwrite an existing folder", async () => {
    fs.mkdirSync(path.join(ctx.projectsDir, "taken"));
    fs.writeFileSync(path.join(ctx.projectsDir, "taken", "keep.txt"), "original");
    const res = await importProject({
      name: "taken",
      files: [{ path: "package.json", content: b64(pkg) }],
    });
    expect(res.statusCode).toBe(409);
    expect(fs.readFileSync(path.join(ctx.projectsDir, "taken", "keep.txt"), "utf8")).toBe(
      "original",
    );
  });

  it.each([
    [{ name: "../up", files: [{ path: "package.json", content: b64(pkg) }] }, 400],
    [{ name: "empty", files: [] }, 400],
    [{ name: "only-secrets", files: [{ path: ".env", content: b64("x") }] }, 400],
    [
      {
        name: "clash",
        files: [
          { path: "package.json", content: b64(pkg) },
          { path: "src", content: b64("x") },
          { path: "src/a.js", content: b64("x") },
        ],
      },
      400,
    ],
  ])("rejects an invalid import (%#)", async (payload, status) => {
    const res = await importProject(payload);
    expect(res.statusCode).toBe(status);
    expect(fs.readdirSync(ctx.projectsDir)).toEqual([]);
  });

  it("imports a project without package.json (e.g. a static site); it just has no test scripts", async () => {
    const res = await importProject({
      name: "portfolio",
      files: [
        { path: "index.html", content: b64("<h1>Hi</h1>") },
        { path: "js/main.js", content: b64("console.log(1);") },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().project.metadata).toMatchObject({ packageName: null, scripts: [] });
    expect(res.json().project.language).toBe("javascript");
  });

  it("cleans up when the uploaded package.json is not valid JSON", async () => {
    const res = await importProject({
      name: "bad-json",
      files: [{ path: "package.json", content: b64("{ not json") }],
    });
    expect(res.statusCode).toBe(400);
    expect(fs.readdirSync(ctx.projectsDir)).toEqual([]);
  });

  it("skips files over the per-file limit", async () => {
    const res = await importProject({
      name: "big",
      files: [
        { path: "package.json", content: b64(pkg) },
        { path: "huge.txt", content: Buffer.alloc(1024 * 1024 + 1).toString("base64") },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().skipped).toEqual([{ path: "huge.txt", reason: "File is larger than 1 MB." }]);
  });
});
