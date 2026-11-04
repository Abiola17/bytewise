"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";

type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Read-only Monaco viewer. Highlights and scrolls to `highlight` when set. */
export function CodeViewer({
  path,
  content,
  language,
  highlight,
}: {
  path: string;
  content: string;
  language: string;
  highlight: LineRange | null;
}) {
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<{ clear(): void } | null>(null);

  const applyHighlight = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    decorationsRef.current?.clear();
    decorationsRef.current = null;
    if (!highlight) return;

    decorationsRef.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(highlight.startLine, 1, highlight.endLine, 1),
        options: {
          isWholeLine: true,
          className: "bytewise-evidence-line",
          linesDecorationsClassName: "bytewise-evidence-gutter",
        },
      },
    ]);
    editor.revealLinesInCenter(highlight.startLine, highlight.endLine);
  };

  // Re-apply when the file or range changes; Monaco keeps the same instance.
  useEffect(applyHighlight, [highlight, content]);

  return (
    <Editor
      height="100%"
      path={path}
      value={content}
      language={language}
      theme="vs-dark"
      loading={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading editor…
        </span>
      }
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        fontSize: 13,
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        automaticLayout: true,
      }}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        applyHighlight();
      }}
    />
  );
}
