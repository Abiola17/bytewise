"use client";

import { useState } from "react";
import { AlertCircle, Columns2, FileDiff, Loader2, Rows2, Sparkles, X } from "lucide-react";
import type { FileContentResponse, PatchProposal } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { CodeViewer, type LineRange } from "@/components/project/code-viewer";
import { DiffViewer } from "@/components/patches/diff-viewer";
import { FileIcon } from "@/components/project/file-tree";
import { Badge } from "@/components/ui/badge";

export type EditorTab = { kind: "file"; path: string } | { kind: "diff"; patchId: string; path: string };

export const tabKey = (t: EditorTab) =>
  t.kind === "file" ? `file:${t.path}` : `diff:${t.patchId}:${t.path}`;

export type FileEntry =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; file: FileContentResponse };

const baseName = (p: string) => p.split("/").pop() ?? p;

export function EditorArea({
  tabs,
  activeKey,
  files,
  highlights,
  patches,
  onActivate,
  onClose,
}: {
  tabs: EditorTab[];
  activeKey: string | null;
  files: Record<string, FileEntry>;
  highlights: Record<string, LineRange | null>;
  patches: PatchProposal[];
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}) {
  const [sideBySide, setSideBySide] = useState(false);
  const active = tabs.find((t) => tabKey(t) === activeKey) ?? null;
  const patchFor = (t: EditorTab) =>
    t.kind === "diff" ? patches.find((p) => p.id === t.patchId) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor">
      <div role="tablist" aria-label="Open editors" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-panel">
        {tabs.map((t) => {
          const key = tabKey(t);
          const selected = key === activeKey;
          return (
            <div
              key={key}
              className={cn(
                "group relative flex shrink-0 items-center border-r text-[13px]",
                selected ? "bg-editor text-foreground" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {selected && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-primary" />}
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onActivate(key)}
                onAuxClick={(e) => e.button === 1 && onClose(key)}
                title={t.path}
                className="flex h-full items-center gap-1.5 pr-1 pl-3"
              >
                {t.kind === "diff" ? (
                  <FileDiff className="size-3.5 text-warning" aria-hidden />
                ) : (
                  <FileIcon path={t.path} />
                )}
                <span className={cn(t.kind === "diff" && "italic")}>{baseName(t.path)}</span>
                {t.kind === "diff" && <span className="text-[11px] text-muted-foreground">(proposed)</span>}
              </button>
              <button
                type="button"
                aria-label={`Close ${baseName(t.path)}`}
                onClick={() => onClose(key)}
                className={cn(
                  "mr-1.5 rounded p-0.5 hover:bg-accent",
                  selected ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {active && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b px-3 font-mono text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{active.path.split("/").join(" › ")}</span>
          {active.kind === "file" && highlights[active.path] && (
            <span className="text-primary">
              lines {highlights[active.path]!.startLine}–{highlights[active.path]!.endLine}
            </span>
          )}
          {active.kind === "diff" && (
            <>
              <DiffStatus patch={patchFor(active)} />
              <button
                type="button"
                onClick={() => setSideBySide((v) => !v)}
                className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-sans hover:bg-accent hover:text-foreground"
              >
                {sideBySide ? <Rows2 className="size-3.5" aria-hidden /> : <Columns2 className="size-3.5" aria-hidden />}
                {sideBySide ? "Inline" : "Side by side"}
              </button>
            </>
          )}
          {active.kind === "file" && <span className="ml-auto font-sans">Read-only</span>}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {!active && <Welcome />}
        {active?.kind === "file" && <FileBody entry={files[active.path]} path={active.path} highlight={highlights[active.path] ?? null} />}
        {active?.kind === "diff" && (() => {
          const file = patchFor(active)?.files.find((f) => f.path === active.path);
          if (!file) return <p className="p-4 text-sm text-muted-foreground">This change is no longer available.</p>;
          return (
            <DiffViewer
              path={file.path}
              original={file.originalContent}
              modified={file.proposedContent}
              sideBySide={sideBySide}
            />
          );
        })()}
      </div>
    </div>
  );
}

function DiffStatus({ patch }: { patch: PatchProposal | undefined }) {
  if (!patch) return null;
  if (patch.status === "proposed") return <Badge variant="warning">Proposed · not applied</Badge>;
  if (patch.status === "applied") return <Badge variant="success">Applied</Badge>;
  return <Badge variant="outline">{patch.status}</Badge>;
}

function FileBody({
  entry,
  path,
  highlight,
}: {
  entry: FileEntry | undefined;
  path: string;
  highlight: LineRange | null;
}) {
  if (!entry || entry.status === "loading") {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Reading file…
      </p>
    );
  }
  if (entry.status === "error") {
    return (
      <p role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
        <AlertCircle className="size-4" aria-hidden /> {entry.message}
      </p>
    );
  }
  return (
    <CodeViewer
      path={path}
      content={entry.file.content}
      language={entry.file.language}
      highlight={highlight}
    />
  );
}

function Welcome() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border bg-card text-primary">
          <Sparkles className="size-6" aria-hidden />
        </div>
        <p className="text-sm font-medium">No file open</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Pick a file in the Explorer, or ask Bytewise in the chat. Files it cites and changes it
          proposes open here.
        </p>
      </div>
    </div>
  );
}
