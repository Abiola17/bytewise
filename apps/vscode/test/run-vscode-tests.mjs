// Downloads a VS Code build (cached in .vscode-test/) and runs the smoke test in it,
// with a temporary workspace folder that includes files the agent must not see.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// When this runs from a terminal inside VS Code, this variable makes the test
// instance start as plain Node instead of an editor. The test needs an editor.
delete process.env.ELECTRON_RUN_AS_NODE;

// Newer macOS builds name the binary "Code" instead of "Electron".
function resolveExecutable(downloaded) {
  if (fs.existsSync(downloaded)) return downloaded;
  const sibling = path.join(path.dirname(downloaded), "Code");
  return fs.existsSync(sibling) ? sibling : downloaded;
}

function createWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-vscode-ws-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-vscode-outside-"));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "smoke",
      scripts: { test: "node -e \"console.log('smoke ok')\"", deploy: "echo no" },
    }),
  );
  write("src/session.js", "const signature = createHmac('sha256', config.secret);\n");
  write(".env", "SECRET=shh");
  write("node_modules/lib/index.js", "config.secret");
  fs.writeFileSync(path.join(outside, "outside.js"), "OUTSIDE_MARKER");
  fs.symlinkSync(outside, path.join(dir, "linkdir"));
  return {
    dir,
    cleanup: () => [dir, outside].forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  };
}

const workspace = createWorkspace();
try {
  const vscodeExecutablePath = resolveExecutable(await downloadAndUnzipVSCode("stable"));
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "dist/test/suite/index.js"),
    launchArgs: [
      workspace.dir,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
    ],
  });
} catch (error) {
  console.error("VS Code smoke test failed:", error);
  process.exitCode = 1;
} finally {
  workspace.cleanup();
}
