"use client";

import { Fragment, type ReactNode } from "react";

export type OpenFileRef = (path: string, line: number | null) => void;

/** `src/a.js`, `src/a.js:14` or `src/a.js:14-20` (also with an en dash). */
const FILE_REF = /^([\w.@/-]+\.[A-Za-z0-9]+)(?::(\d+)(?:[-–](\d+))?)?$/;

function InlineCode({
  text,
  knownFiles,
  onOpenFile,
}: {
  text: string;
  knownFiles: Set<string>;
  onOpenFile: OpenFileRef;
}) {
  const match = text.match(FILE_REF);
  if (match && knownFiles.has(match[1]!)) {
    const line = match[2] ? Number(match[2]) : null;
    return (
      <button
        type="button"
        onClick={() => onOpenFile(match[1]!, line)}
        title="Open in editor"
        className="rounded bg-primary/10 px-1 py-px font-mono text-[0.85em] text-primary hover:bg-primary/20 hover:underline"
      >
        {text}
      </button>
    );
  }
  return <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">{text}</code>;
}

/** Inline formatting: `code` and **bold**. Everything else stays literal text. */
function inline(text: string, knownFiles: Set<string>, onOpenFile: OpenFileRef): ReactNode[] {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <InlineCode key={i} text={part.slice(1, -1)} knownFiles={knownFiles} onOpenFile={onOpenFile} />
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * Renders model text as React elements (never HTML): fenced code blocks,
 * bullet lists, inline code and bold. File references become editor links.
 */
export function RichText({
  text,
  knownFiles,
  onOpenFile,
}: {
  text: string;
  knownFiles: Set<string>;
  onOpenFile: OpenFileRef;
}) {
  const blocks: ReactNode[] = [];
  const segments = text.split(/```/);
  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      const newline = segment.indexOf("\n");
      const lang = newline > 0 ? segment.slice(0, newline).trim() : "";
      const code = newline >= 0 ? segment.slice(newline + 1) : segment;
      blocks.push(
        <div key={`c${index}`} className="overflow-hidden rounded-lg border bg-editor">
          {lang && (
            <div className="border-b px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {lang}
            </div>
          )}
          <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
            {code.replace(/\n$/, "")}
          </pre>
        </div>,
      );
      return;
    }
    const paragraphs = segment.split(/\n{2,}/).filter((p) => p.trim());
    paragraphs.forEach((paragraph, p) => {
      const lines = paragraph.split("\n");
      const isList = lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
      if (isList) {
        const ordered = /^\s*\d+\./.test(lines[0]!);
        const Tag = ordered ? "ol" : "ul";
        blocks.push(
          <Tag
            key={`l${index}-${p}`}
            className={ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}
          >
            {lines.map((l, i) => (
              <li key={i}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), knownFiles, onOpenFile)}</li>
            ))}
          </Tag>,
        );
      } else {
        blocks.push(
          <p key={`p${index}-${p}`} className="whitespace-pre-wrap break-words">
            {inline(paragraph, knownFiles, onOpenFile)}
          </p>,
        );
      }
    });
  });
  return <div className="space-y-2.5 text-sm leading-relaxed">{blocks}</div>;
}
