"use client";

import { DiffEditor } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  md: "markdown",
};

/** Read-only before/after view of one file in a patch. */
export function DiffViewer({
  path,
  original,
  modified,
}: {
  path: string;
  original: string;
  modified: string;
}) {
  const language = LANGUAGE_BY_EXTENSION[path.split(".").pop() ?? ""] ?? "plaintext";
  return (
    <DiffEditor
      height="100%"
      original={original}
      modified={modified}
      language={language}
      originalModelPath={`original/${path}`}
      modifiedModelPath={`modified/${path}`}
      theme="vs-dark"
      loading={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading diff…
        </span>
      }
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: false,
        minimap: { enabled: false },
        fontSize: 12,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
      }}
    />
  );
}
