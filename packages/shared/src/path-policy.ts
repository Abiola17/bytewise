/**
 * What Bytewise may see inside a project. Applied to discovery, file reads,
 * search and evidence — so excluded content can never reach the UI or model.
 */

const EXCLUDED_DIRECTORIES = new Set([
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

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, ... (.env.example is allowed below)
  /\.(pem|key|p12|pfx|crt|cer|der|jks|keystore|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^\.(npmrc|netrc|pgpass|htpasswd)$/i,
  /credentials/i,
  /^secrets?\./i,
  /\.(sqlite3?|db)$/i,
];

const ALLOWED_DESPITE_PATTERN = new Set([".env.example"]);

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "webp",
  "bmp",
  "svgz",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "tar",
  "7z",
  "rar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "wav",
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "class",
  "jar",
  "node",
  "bin",
]);

export function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name);
}

export function isSensitiveFile(name: string): boolean {
  if (ALLOWED_DESPITE_PATTERN.has(name)) return false;
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isBinaryPath(name: string): boolean {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return BINARY_EXTENSIONS.has(ext);
}

export type PathCheck = { allowed: true } | { allowed: false; reason: string };

/** Checks a normalized project-relative POSIX path against the policy. */
export function checkRelativePath(relativePath: string): PathCheck {
  const segments = relativePath.split("/");
  const fileName = segments[segments.length - 1] ?? "";

  for (const segment of segments.slice(0, -1)) {
    if (isExcludedDirectory(segment)) {
      return { allowed: false, reason: `Directory "${segment}" is excluded.` };
    }
  }
  if (isSensitiveFile(fileName)) {
    return { allowed: false, reason: "This file may contain secrets and is excluded." };
  }
  if (isBinaryPath(fileName)) {
    return { allowed: false, reason: "Binary files are not supported." };
  }
  return { allowed: true };
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  sql: "sql",
};

export function languageForPath(relativePath: string): string {
  const ext = relativePath.slice(relativePath.lastIndexOf(".") + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}
