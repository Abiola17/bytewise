"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Bug, FileCode2, Loader2 } from "lucide-react";
import type { EvidenceItem, FileContentResponse } from "@bytewise/shared";
import { api } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { CodeViewer, type LineRange } from "./code-viewer";
import { FileTree } from "./file-tree";

type FileState =
  | { status: "none" }
  | { status: "loading"; path: string }
  | { status: "error"; path: string; message: string }
  | { status: "success"; file: FileContentResponse };

export function ProjectWorkspace({
  projectId,
  initialFile = null,
}: {
  projectId: string;
  /** File (and optional line range) to open first, e.g. from an evidence link. */
  initialFile?: { path: string; range: LineRange | null } | null;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function startSession() {
    setStarting(true);
    setStartError(null);
    try {
      const session = await api.createSession(projectId);
      router.push(`/sessions/${session.id}`);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start a session.");
      setStarting(false);
    }
  }

  const project = useApi(useCallback(() => api.getProject(projectId), [projectId]));
  const files = useApi(useCallback(() => api.listFiles(projectId), [projectId]));

  const [fileState, setFileState] = useState<FileState>({ status: "none" });
  const [highlight, setHighlight] = useState<LineRange | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const evidencePaths = useMemo(() => new Set(evidence.map((e) => e.relativePath)), [evidence]);

  const openFile = useCallback(
    async (path: string, range: LineRange | null = null) => {
      setHighlight(range);
      if (fileState.status === "success" && fileState.file.path === path) return;
      setFileState({ status: "loading", path });
      try {
        setFileState({ status: "success", file: await api.readFile(projectId, path) });
      } catch (error) {
        setFileState({
          status: "error",
          path,
          message: error instanceof Error ? error.message : "Could not read file.",
        });
      }
    },
    [fileState, projectId],
  );

  // Open package.json (or the first file) once the file list arrives.
  useEffect(() => {
    if (files.state.status !== "success" || fileState.status !== "none") return;
    const list = files.state.data.files;
    if (initialFile) {
      void openFile(initialFile.path, initialFile.range);
      return;
    }
    const initial = list.find((f) => f.path === "package.json") ?? list[0];
    if (initial) void openFile(initial.path);
  }, [files.state, fileState.status, openFile, initialFile]);

  if (project.state.status === "loading") {
    return (
      <p className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading project…
      </p>
    );
  }
  if (project.state.status === "error") {
    return (
      <div role="alert" className="space-y-3 p-8 text-sm">
        <p className="flex items-center gap-2 text-destructive">
          <AlertCircle className="size-4" aria-hidden /> {project.state.message}
        </p>
        <Link href="/projects" className="text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const { data } = project.state;
  const currentPath =
    fileState.status === "success"
      ? fileState.file.path
      : fileState.status === "none"
        ? null
        : fileState.path;

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col max-md:h-auto">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <Link
          href="/projects"
          aria-label="Back to projects"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="font-semibold">{data.name}</h1>
        <Badge variant="outline">{data.language}</Badge>
        {data.metadata.scripts.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Scripts:
            {data.metadata.scripts.map((s) => (
              <code key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                {s}
              </code>
            ))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {startError && (
            <span role="alert" className="text-xs text-destructive">
              {startError}
            </span>
          )}
          <Button size="sm" onClick={() => void startSession()} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" aria-hidden /> : <Bug aria-hidden />}
            New debugging session
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_360px]">
        <aside className="overflow-y-auto border-b p-2 md:border-r md:border-b-0 max-md:max-h-60">
          {files.state.status === "loading" && (
            <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Listing files…
            </p>
          )}
          {files.state.status === "error" && (
            <p role="alert" className="p-2 text-sm text-destructive">
              {files.state.message}
            </p>
          )}
          {files.state.status === "success" && (
            <>
              <FileTree
                files={files.state.data.files}
                selected={currentPath}
                highlighted={evidencePaths}
                onSelect={(p) => void openFile(p)}
              />
              {files.state.data.truncated && (
                <p className="p-2 text-xs text-warning">File list truncated at the limit.</p>
              )}
              <p className="p-2 text-xs text-muted-foreground">
                Dependencies, build output, secrets and binaries are hidden.
              </p>
            </>
          )}
        </aside>

        <section className="flex min-h-[420px] min-w-0 flex-col">
          <div className="flex h-9 items-center gap-2 border-b px-3 font-mono text-xs text-muted-foreground">
            <FileCode2 className="size-3.5" aria-hidden />
            {currentPath ?? "No file selected"}
            {highlight && (
              <span className="text-primary">
                · lines {highlight.startLine}–{highlight.endLine}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {fileState.status === "loading" && (
              <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Reading file…
              </p>
            )}
            {fileState.status === "error" && (
              <p role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
                <AlertCircle className="size-4" aria-hidden /> {fileState.message}
              </p>
            )}
            {fileState.status === "success" && (
              <CodeViewer
                path={fileState.file.path}
                content={fileState.file.content}
                language={fileState.file.language}
                highlight={highlight}
              />
            )}
          </div>
        </section>

        <aside className="min-h-[420px] border-t md:col-span-2 xl:col-span-1 xl:border-t-0 xl:border-l">
          <EvidencePanel
            projectId={projectId}
            onEvidenceChange={setEvidence}
            onSelect={(item) =>
              void openFile(item.relativePath, {
                startLine: item.startLine,
                endLine: item.endLine,
              })
            }
          />
        </aside>
      </div>
    </div>
  );
}
