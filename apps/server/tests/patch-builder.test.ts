import { describe, expect, it } from "vitest";
import { buildPatch, PatchValidationError, patchPathProblem } from "../src/services/patch-builder";

const files = new Map([
  ["src/a.js", "const x = 1;\nconst y = x + 1;\nexport { y };\n"],
  ["src/dup.js", "foo();\nfoo();\n"],
  ["src/crlf.js", "let a = 1;\r\nlet b = 2;\r\n"],
]);

function problems(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof PatchValidationError) return error.problems;
    throw error;
  }
  throw new Error("expected a PatchValidationError");
}

describe("buildPatch", () => {
  it("applies exact edits and produces a unified diff with stats", () => {
    const [file] = buildPatch(
      [{ path: "src/a.js", summary: "fix", edits: [{ find: "x + 1", replace: "x + 2" }] }],
      files,
    );
    expect(file!.proposedContent).toBe("const x = 1;\nconst y = x + 2;\nexport { y };\n");
    expect(file!.additions).toBe(1);
    expect(file!.deletions).toBe(1);
    expect(file!.diff).toContain("-const y = x + 1;");
    expect(file!.diff).toContain("+const y = x + 2;");
    expect(file!.originalHash).not.toBe(file!.proposedHash);
  });

  it("applies multiple edits in order", () => {
    const [file] = buildPatch(
      [
        {
          path: "src/a.js",
          summary: "",
          edits: [
            { find: "const x = 1;", replace: "const x = 5;" },
            { find: "const x = 5;\nconst y", replace: "const x = 5;\nlet y" },
          ],
        },
      ],
      files,
    );
    expect(file!.proposedContent).toBe("const x = 5;\nlet y = x + 1;\nexport { y };\n");
  });

  it("treats a literal $ in the replacement as text", () => {
    const [file] = buildPatch(
      [{ path: "src/a.js", summary: "", edits: [{ find: "x + 1", replace: "`$&$1`" }] }],
      files,
    );
    expect(file!.proposedContent).toContain("const y = `$&$1`;");
  });

  it("preserves CRLF line endings", () => {
    const [file] = buildPatch(
      [{ path: "src/crlf.js", summary: "", edits: [{ find: "1;\nlet b", replace: "3;\nlet b" }] }],
      files,
    );
    expect(file!.proposedContent).toBe("let a = 3;\r\nlet b = 2;\r\n");
  });

  it("rejects ambiguous, missing and no-op edits", () => {
    expect(
      problems(() =>
        buildPatch(
          [{ path: "src/dup.js", summary: "", edits: [{ find: "foo();", replace: "bar();" }] }],
          files,
        ),
      )[0],
    ).toMatch(/occurs 2 times/);
    expect(
      problems(() =>
        buildPatch(
          [{ path: "src/a.js", summary: "", edits: [{ find: "nope", replace: "x" }] }],
          files,
        ),
      )[0],
    ).toMatch(/occurs 0 times/);
    expect(
      problems(() =>
        buildPatch(
          [{ path: "src/a.js", summary: "", edits: [{ find: "x", replace: "x" }] }],
          files,
        ),
      )[0],
    ).toMatch(/identical/);
  });

  it("rejects files that were not provided (no file creation)", () => {
    expect(
      problems(() =>
        buildPatch(
          [{ path: "src/new.js", summary: "", edits: [{ find: "a", replace: "b" }] }],
          files,
        ),
      )[0],
    ).toMatch(/new files cannot be created/);
  });

  it("rejects too many files", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      path: `src/f${i}.js`,
      summary: "",
      edits: [{ find: "a", replace: "b" }],
    }));
    expect(problems(() => buildPatch(many, files))[0]).toMatch(/limit is 5/);
  });
});

describe("patchPathProblem", () => {
  it.each([
    ["../../.env", /inside the project/],
    ["/etc/passwd", /Absolute/],
    ["./src/a.js", /normalized/],
    [".env", /secrets/],
    ["node_modules/x/index.js", /excluded/],
    ["test/login.test.js", /test files/],
    ["src/login.spec.ts", /test files/],
    ["package.json", /dependency manifests/],
    ["pnpm-lock.yaml", /dependency manifests/],
  ])("rejects %j", (p, reason) => {
    expect(patchPathProblem(p)).toMatch(reason);
  });

  it("allows ordinary source files", () => {
    expect(patchPathProblem("src/services/session.js")).toBeNull();
  });
});
