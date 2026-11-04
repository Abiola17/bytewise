import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  availableProjectsResponseSchema,
  fileContentResponseSchema,
  fileListResponseSchema,
  searchResponseSchema,
} from "@bytewise/shared";
import { createTestApp } from "./helpers";

describe("project files API", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let projectId: string;
  let root: string;
  let outside: string;

  function write(relativePath: string, content: string | Buffer) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    root = path.join(ctx.projectsDir, "app");
    fs.mkdirSync(root);
    write("package.json", JSON.stringify({ name: "app" }));
    write("src/index.ts", "export const greeting = 'hello';\nconsole.log(greeting);\n");
    write("src/util.ts", "export function add(a: number, b: number) {\n  return a + b;\n}\n");
    write(".env", "SECRET=shh");
    write(".env.example", "SECRET=");
    write("keys/server.pem", "-----BEGIN PRIVATE KEY-----");
    write("node_modules/lib/index.js", "module.exports = 1;");
    write(".git/config", "[core]");
    write("dist/out.js", "compiled");
    write("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write("data.txt", Buffer.from([0x61, 0x00, 0x62]));
    write("big.txt", "x".repeat(600 * 1024));

    outside = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE_MARKER_42");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    fs.symlinkSync(outside, path.join(root, "linkdir"));

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { directory: "app" },
    });
    projectId = res.json().id;
  });

  afterEach(async () => {
    await ctx.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const get = (url: string) => ctx.app.inject({ method: "GET", url });

  it("lists only allowed files", async () => {
    const res = await get(`/api/v1/projects/${projectId}/files`);
    expect(res.statusCode).toBe(200);
    const { files, truncated } = fileListResponseSchema.parse(res.json());
    expect(truncated).toBe(false);
    expect(files.map((f) => f.path)).toEqual([
      ".env.example",
      "big.txt",
      "data.txt",
      "package.json",
      "src/index.ts",
      "src/util.ts",
    ]);
  });

  it("reads a file with metadata", async () => {
    const res = await get(`/api/v1/projects/${projectId}/files/content?path=src/util.ts`);
    expect(res.statusCode).toBe(200);
    expect(fileContentResponseSchema.parse(res.json())).toMatchObject({
      path: "src/util.ts",
      lineCount: 3,
      language: "typescript",
    });
  });

  it.each([
    ["../../../etc/passwd", 400],
    ["/etc/passwd", 400],
    [".env", 403],
    ["keys/server.pem", 403],
    ["node_modules/lib/index.js", 403],
    ["link.txt", 403],
    ["linkdir/secret.txt", 403],
    ["missing.ts", 404],
    ["src", 400],
    ["big.txt", 413],
    ["data.txt", 415],
  ])("refuses to read %j (%i)", async (filePath, status) => {
    const res = await get(
      `/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`,
    );
    expect(res.statusCode).toBe(status);
    expect(res.body).not.toContain("SECRET=shh");
    expect(res.body).not.toContain("OUTSIDE_MARKER_42");
  });

  it("searches file contents case-insensitively", async () => {
    const res = await get(`/api/v1/projects/${projectId}/search?q=GREETING`);
    const { matches } = searchResponseSchema.parse(res.json());
    expect(matches).toEqual([
      { path: "src/index.ts", line: 1, column: 14, preview: "export const greeting = 'hello';" },
      { path: "src/index.ts", line: 2, column: 13, preview: "console.log(greeting);" },
    ]);
  });

  it("never searches excluded files", async () => {
    const res = await get(`/api/v1/projects/${projectId}/search?q=SECRET`);
    const { matches } = searchResponseSchema.parse(res.json());
    expect(matches.map((m) => m.path)).toEqual([".env.example"]);
  });

  it("returns 404 for an unknown project", async () => {
    expect((await get(`/api/v1/projects/nope/files`)).statusCode).toBe(404);
  });

  it("lists unregistered project directories", async () => {
    fs.mkdirSync(path.join(ctx.projectsDir, "other"));
    const res = await get(`/api/v1/projects/available`);
    expect(availableProjectsResponseSchema.parse(res.json()).directories).toEqual(["other"]);
  });
});
