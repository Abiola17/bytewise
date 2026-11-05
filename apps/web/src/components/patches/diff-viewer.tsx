"use client";

import { DiffEditor } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";
import { MONACO_FONT, MONACO_THEME, defineBytewiseTheme } from "@/lib/monaco-theme";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
};

/** Read-only before/after view of one file in a patch. */
export function DiffViewer({
  path,
  original,
  modified,
  sideBySide = false,
}: {
  path: string;
  original: string;
  modified: string;
  sideBySide?: boolean;
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
      theme={MONACO_THEME}
      beforeMount={defineBytewiseTheme}
      loading={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading diff…
        </span>
      }
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        useInlineViewWhenSpaceIsLimited: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: MONACO_FONT,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
      }}
    />
  );
}
