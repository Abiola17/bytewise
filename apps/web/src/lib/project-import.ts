import { unzipSync } from "fflate";
import { IMPORT_LIMITS, type ImportProjectRequest } from "@bytewise/shared";

/**
 * Prepares a project for upload in the browser. Mirrors the server's path
 * policy only to avoid uploading what would be refused anyway (dependencies,
 * build output, version control, secrets, binaries). The server re-checks everything.
 */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".vercel",
  ".idea",
  ".vscode",
  ".data",
]);
const SECRET_FILE =
  /^\.env(\..+)?$|\.(pem|key|p12|pfx|crt|cer|der|jks|keystore|asc|gpg)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.(npmrc|netrc|pgpass|htpasswd)$|credentials|^secrets?\.|\.(sqlite3?|db)$/i;
const BINARY_FILE =
  /\.(png|jpe?g|gif|ico|webp|bmp|svgz|pdf|zip|gz|tgz|tar|7z|rar|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|wav|exe|dll|so|dylib|wasm|class|jar|node|bin)$/i;

export type SkipReason =
  | "dependency, build or version-control"
  | "possible secret"
  | "image or other binary"
  | "too large";

interface Entry {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

export interface PreparedImport {
  suggestedName: string;
  files: Array<{ path: string; bytes: Uint8Array }>;
  totalBytes: number;
  skipped: Record<SkipReason, number>;
  hasPackageJson: boolean;
  /** Subfolders that contain their own package.json, shallowest first (e.g. "frontend"). */
  nestedPackageRoots: string[];
  /** Everything that was selected, so a subfolder can be chosen as the root later. */
  entries: Entry[];
}

function skipReason(path: string, size: number): SkipReason | null {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  if (parts.slice(0, -1).some((p) => SKIP_DIRECTORIES.has(p))) {
    return "dependency, build or version-control";
  }
  if (name !== ".env.example" && SECRET_FILE.test(name)) return "possible secret";
  if (BINARY_FILE.test(name)) return "image or other binary";
  if (size > IMPORT_LIMITS.maxFileBytes) return "too large";
  return null;
}

/** Folder names become directory names on the server: keep to safe characters. */
export function toProjectName(raw: string): string {
  const cleaned = raw
    .replace(/\.zip$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return cleaned || "imported-project";
}

async function prepare(entries: Entry[], suggestedName: string): Promise<PreparedImport> {
  const skipped: PreparedImport["skipped"] = {
    "dependency, build or version-control": 0,
    "possible secret": 0,
    "image or other binary": 0,
    "too large": 0,
  };
  const files: PreparedImport["files"] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const reason = skipReason(entry.path, entry.size);
    if (reason) {
      skipped[reason]++;
      continue;
    }
    files.push({ path: entry.path, bytes: await entry.read() });
    totalBytes += entry.size;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const nestedPackageRoots = files
    .filter((f) => f.path.endsWith("/package.json"))
    .map((f) => f.path.slice(0, -"/package.json".length))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, 5);

  return {
    suggestedName: toProjectName(suggestedName),
    files,
    totalBytes,
    skipped,
    hasPackageJson: files.some((f) => f.path === "package.json"),
    nestedPackageRoots,
    entries,
  };
}

/** Removes a folder prefix shared by every path (e.g. "my-app/src/a.js" → "src/a.js"). */
function stripCommonRoot(paths: string[]): { root: string | null; strip: (p: string) => string } {
  const first = paths[0]?.split("/")[0];
  const shared =
    first !== undefined && paths.length > 0 && paths.every((p) => p.startsWith(`${first}/`));
  return shared
    ? { root: first, strip: (p) => p.slice(first.length + 1) }
    : { root: null, strip: (p) => p };
}

/** Files picked with a folder chooser (`webkitdirectory`). */
export async function prepareFolder(fileList: FileList): Promise<PreparedImport> {
  const all = Array.from(fileList);
  const paths = all.map((f) => f.webkitRelativePath || f.name);
  const { root, strip } = stripCommonRoot(paths);
  const entries = all.map((file, i) => ({
    path: strip(paths[i]!),
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }));
  return prepare(entries, root ?? "imported-project");
}

/** A .zip archive, unpacked in the browser. */
export async function prepareZip(file: File): Promise<PreparedImport> {
  if (file.size > IMPORT_LIMITS.maxTotalBytes * 4) {
    throw new Error(
      "The .zip file is too large (limit 100 MB, 25 MB after skipping dependencies).",
    );
  }
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("This file could not be read as a .zip archive.");
  }
  const paths = Object.keys(unzipped).filter(
    (p) => !p.endsWith("/") && !p.startsWith("__MACOSX/") && !p.endsWith(".DS_Store"),
  );
  const { root, strip } = stripCommonRoot(paths);
  const entries = paths.map((p) => ({
    path: strip(p),
    size: unzipped[p]!.length,
    read: async () => unzipped[p]!,
  }));
  return prepare(entries, root ?? file.name);
}

/** Uses a subfolder (e.g. one containing package.json) as the project's root instead. */
export function rerootAtSubfolder(prepared: PreparedImport, folder: string) {
  const prefix = `${folder}/`;
  const entries = prepared.entries
    .filter((e) => e.path.startsWith(prefix))
    .map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  return prepare(entries, folder.split("/").pop() ?? folder);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function toImportRequest(prepared: PreparedImport, name: string): ImportProjectRequest {
  return {
    name,
    files: prepared.files.map((f) => ({ path: f.path, content: toBase64(f.bytes) })),
  };
}
