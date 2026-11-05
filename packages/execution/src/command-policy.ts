import fs from "node:fs";
import path from "node:path";
import type { VerificationCommand } from "@bytewise/shared";

/**
 * Only these package.json script names may run. Scripts are the project's own
 * configuration — never model output — and patches cannot edit package.json.
 */
const ALLOWED_SCRIPT = /^(test|test:[\w.-]+|typecheck|type-check|lint|check)$/;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

type PackageManager = "npm" | "pnpm" | "yarn";

export interface ResolvedCommand {
  script: string;
  label: string;
  definition: string;
  file: PackageManager;
  args: string[];
}

export type CommandResolution =
  { allowed: true; command: ResolvedCommand } | { allowed: false; reason: string; label: string };

function packageManager(projectRoot: string): PackageManager {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

/** Reads scripts fresh from disk, so the policy always reflects the current package.json. */
function readScripts(projectRoot: string): Record<string, string> {
  const file = path.join(projectRoot, "package.json");
  try {
    if (fs.statSync(file).size > MAX_PACKAGE_JSON_BYTES) return {};
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { scripts?: unknown };
    if (!pkg.scripts || typeof pkg.scripts !== "object") return {};
    return Object.fromEntries(
      Object.entries(pkg.scripts as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function toCommand(projectRoot: string, script: string, definition: string): ResolvedCommand {
  const pm = packageManager(projectRoot);
  return {
    script,
    label: `${pm} run ${script}`,
    definition,
    file: pm,
    args: ["run", script],
  };
}

export function listVerificationCommands(projectRoot: string): VerificationCommand[] {
  return Object.entries(readScripts(projectRoot))
    .filter(([name]) => ALLOWED_SCRIPT.test(name))
    .map(([name, definition]) => {
      const { script, label } = toCommand(projectRoot, name, definition);
      return { script, label, definition };
    });
}

export function resolveVerificationCommand(projectRoot: string, script: string): CommandResolution {
  const label = `run ${script}`;
  if (!ALLOWED_SCRIPT.test(script)) {
    return {
      allowed: false,
      label,
      reason: `"${script}" is not an allowed verification script (allowed: test, test:*, typecheck, lint, check).`,
    };
  }
  const definition = readScripts(projectRoot)[script];
  if (definition === undefined) {
    return { allowed: false, label, reason: `package.json has no "${script}" script.` };
  }
  return { allowed: true, command: toCommand(projectRoot, script, definition) };
}
