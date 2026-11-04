// Gives the end-to-end run its own database and a throwaway copy of the demo
// project, so applying a patch never touches examples/ or the dev database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2eDir = path.join(repoRoot, ".data", "e2e");

fs.rmSync(e2eDir, { recursive: true, force: true });
fs.mkdirSync(path.join(e2eDir, "projects"), { recursive: true });
fs.cpSync(
  path.join(repoRoot, "examples", "broken-login-app"),
  path.join(e2eDir, "projects", "broken-login-app"),
  { recursive: true },
);
console.log(`e2e workspace prepared at ${e2eDir}`);
