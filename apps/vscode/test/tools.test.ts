import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeToolPath, runTool } from "../src/agent/tools";
import { createNodeWorkspaceFs, type WorkspaceFs } from "../src/agent/workspace-fs";

let root: string;
let outside: string;
let ws: WorkspaceFs;

function write(rel: string, content: string | Buffer) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-ws-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-outside-"));
  fs.writeFileSync(path.join(outside, "outside.js"), "OUTSIDE_MARKER");
  write("package.json", '{"name":"demo"}');
  write("src/config.js", "export const config = {\n  sessionSecret: 'dev',\n};\n");
  write(
    "src/services/session.js",
    "import { config } from '../config.js';\n" +
      Array.from({ length: 12 }, (_, i) => `// line ${i + 2}`).join("\n") +
      "\nconst signature = createHmac('sha256', config.secret);\n",
  );
  write("test/login.test.js", "test('login', () => {});\n");
  write(".env", "SECRET=shh");
  write("node_modules/lib/index.js", "config.secret");
  write(".git/config", "[core]");
  write("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write("big.txt", "x".repeat(1024 * 1024 + 1));
  write("bin.dat", Buffer.from([0x61, 0x00, 0x62]));
  write("long.txt", Array.from({ length: 1000 }, (_, i) => `row ${i + 1}`).join("\n"));
  fs.symlinkSync(path.join(outside, "outside.js"), path.join(root, "link.js"));
  fs.symlinkSync(outside, path.join(root, "linkdir"));
  ws = createNodeWorkspaceFs(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const call = (name: string, args: object | string) =>
  runTool(ws, name, typeof args === "string" ? args : JSON.stringify(args));

describe("list_files", () => {
  it("lists visible files and hides dependencies, secrets, binaries and links", async () => {
    const out = await call("list_files", {});
    expect(out.ok).toBe(true);
    const lines = out.output.split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "src/",
        "src/config.js",
        "src/services/",
        "src/services/session.js",
        "test/",
        "package.json",
      ]),
    );
    for (const hidden of [".env", "node_modules/", ".git/", "logo.png", "link.js", "linkdir/"]) {
      expect(lines).not.toContain(hidden);
    }
  });

  it("respects max_depth and refuses excluded or escaping folders", async () => {
    expect((await call("list_files", { max_depth: 1 })).output).not.toContain("src/config.js");
    expect((await call("list_files", { path: "node_modules" })).ok).toBe(false);
    expect((await call("list_files", { path: "../" })).ok).toBe(false);
    expect((await call("list_files", { path: "linkdir" })).ok).toBe(false);
  });
});

describe("read_file", () => {
  it("returns numbered lines with a summary for the panel", async () => {
    const out = await call("read_file", { path: "src/services/session.js" });
    expect(out).toMatchObject({ ok: true, path: "src/services/session.js", line: 1 });
    expect(out.output).toContain("   14 | const signature = createHmac('sha256', config.secret);");
    expect(out.summary).toBe("Read src/services/session.js (lines 1–14 of 14)");
  });

  it("reads a range and points to the rest of long files", async () => {
    const out = await call("read_file", { path: "long.txt", start_line: 990 });
    expect(out.output).toContain("  990 | row 990");
    expect(out.output).toContain(" 1000 | row 1000");
    const first = await call("read_file", { path: "long.txt" });
    expect(first.output).toMatch(/lines 401–1000 not shown; call read_file with start_line=401/);
  });

  it.each([
    ["../outside.js", /outside the workspace/],
    ["/etc/passwd", /absolute/],
    [".env", /secrets/],
    ["node_modules/lib/index.js", /excluded/],
    ["logo.png", /Binary/],
    ["link.js", /not a regular file/],
    ["linkdir/outside.js", /linked folder/],
    [".env.local", /secrets/],
    ["src/../.env", /secrets/],
    ["missing.js", /not found/],
    ["big.txt", /larger than 1 MB/],
    ["bin.dat", /binary/],
  ])("refuses %j", async (p, reason) => {
    const out = await call("read_file", { path: p });
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(reason);
    expect(out.output).not.toContain("OUTSIDE_MARKER");
    expect(out.output).not.toContain("SECRET=shh");
  });
});

describe("search_files", () => {
  it("finds matches in visible files only", async () => {
    const out = await call("search_files", { query: "CONFIG.SECRET" });
    expect(out.output).toBe(
      "src/services/session.js:14: const signature = createHmac('sha256', config.secret);",
    );
    expect(out).toMatchObject({ path: "src/services/session.js", line: 14 });
  });

  it("never searches secrets, dependencies or linked folders", async () => {
    expect((await call("search_files", { query: "SECRET=shh" })).output).toMatch(/No matches/);
    expect((await call("search_files", { query: "OUTSIDE_MARKER" })).output).toMatch(/No matches/);
  });

  it("limits the search to a folder", async () => {
    expect((await call("search_files", { query: "login", path: "src" })).output).toMatch(
      /No matches/,
    );
    expect((await call("search_files", { query: "login", path: "test" })).output).toContain(
      "test/login.test.js:1",
    );
  });
});

describe("bad tool calls", () => {
  it("returns errors to the model instead of throwing", async () => {
    expect((await call("read_file", "{not json")).output).toMatch(/not valid JSON/);
    expect((await call("read_file", {})).output).toMatch(/needs a "path"/);
    expect((await call("delete_everything", {})).output).toMatch(/no tool named/);
    expect((await call("search_files", { query: "a" })).ok).toBe(false);
  });
});

describe("normalizeToolPath", () => {
  it("normalizes and rejects escapes", () => {
    expect(normalizeToolPath("./src//a.js")).toEqual({ path: "src/a.js" });
    expect(normalizeToolPath("src\\a.js")).toEqual({ path: "src/a.js" });
    expect(normalizeToolPath("")).toEqual({ path: "" });
    expect(normalizeToolPath("~/x")).toHaveProperty("error");
    expect(normalizeToolPath("a/../../b")).toHaveProperty("error");
    expect(normalizeToolPath("../x")).toHaveProperty("error");
    expect(normalizeToolPath(".env")).toEqual({ path: ".env" });
    expect(normalizeToolPath("./.env")).toEqual({ path: ".env" });
    expect(normalizeToolPath(".")).toEqual({ path: "" });
    for (const root of ["./", "/", '""', "''", " . "])
      expect(normalizeToolPath(root)).toEqual({ path: "" });
    expect(normalizeToolPath('"src/a.js"')).toEqual({ path: "src/a.js" });
    expect(normalizeToolPath("/etc/passwd")).toHaveProperty("error");
  });
});
