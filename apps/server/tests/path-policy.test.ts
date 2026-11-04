import { describe, expect, it } from "vitest";
import { checkRelativePath, isSensitiveFile } from "../src/filesystem/path-policy";
import { normalizeRelativePath } from "../src/filesystem/project-root";

describe("path policy", () => {
  it.each([
    ".env",
    ".env.local",
    "server.pem",
    "id_rsa",
    ".npmrc",
    "aws-credentials.json",
    "app.db",
  ])("treats %j as sensitive", (name) => expect(isSensitiveFile(name)).toBe(true));

  it.each([".env.example", "config.js", "session.ts", "README.md"])("allows %j", (name) =>
    expect(isSensitiveFile(name)).toBe(false),
  );

  it("rejects files inside excluded directories", () => {
    expect(checkRelativePath("node_modules/x/index.js").allowed).toBe(false);
    expect(checkRelativePath("a/.git/config").allowed).toBe(false);
    expect(checkRelativePath("dist/bundle.js").allowed).toBe(false);
    expect(checkRelativePath("src/build.ts").allowed).toBe(true);
  });

  it("rejects binary files", () => {
    expect(checkRelativePath("public/logo.png").allowed).toBe(false);
  });
});

describe("normalizeRelativePath", () => {
  it("normalizes harmless paths", () => {
    expect(normalizeRelativePath("./src//a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("src\\a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("src/x/../a.ts")).toBe("src/a.ts");
  });

  it.each(["../a", "src/../../a", "/etc/passwd", "C:/x", ".", "a\0b"])("rejects %j", (input) =>
    expect(() => normalizeRelativePath(input)).toThrow(),
  );
});
