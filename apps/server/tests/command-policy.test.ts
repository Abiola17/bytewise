import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listVerificationCommands,
  resolveVerificationCommand,
} from "../src/execution/command-policy";

const roots: string[] = [];
function project(scripts: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-policy-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "p", scripts }));
  return root;
}
afterEach(() => roots.splice(0).forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

describe("command policy", () => {
  const scripts = {
    dev: "next dev",
    build: "next build",
    start: "next start",
    lint: "eslint",
    "test:unit": "vitest",
    deploy: "vercel",
  };

  it("offers check scripts and build, never servers or deploys", () => {
    expect(listVerificationCommands(project(scripts)).map((c) => c.script)).toEqual([
      "build",
      "lint",
      "test:unit",
    ]);
  });

  it("resolves build to the package manager's run command, without a shell", () => {
    const result = resolveVerificationCommand(project(scripts), "build");
    expect(result).toMatchObject({
      allowed: true,
      command: { file: "npm", args: ["run", "build"], definition: "next build" },
    });
  });

  it.each(["dev", "start", "deploy", "build && rm -rf /", "build:prod"])("blocks %j", (script) => {
    expect(resolveVerificationCommand(project(scripts), script).allowed).toBe(false);
  });
});
