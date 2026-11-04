"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  FileArchive,
  FolderInput,
  FolderUp,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { IMPORT_LIMITS } from "@bytewise/shared";
import { api } from "@/lib/api-client";
import {
  prepareFolder,
  prepareZip,
  toImportRequest,
  toProjectName,
  rerootAtSubfolder,
  type PreparedImport,
} from "@/lib/project-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Lets the developer upload a project folder or .zip from their computer. */
export function ImportProject() {
  const router = useRouter();
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "reading" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  // React does not pass `webkitdirectory` through as a known prop; set it directly.
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  async function choose(read: () => Promise<PreparedImport>) {
    setError(null);
    setPrepared(null);
    setStatus("reading");
    try {
      const result = await read();
      setPrepared(result);
      setName(result.suggestedName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the selected files.");
    } finally {
      setStatus("idle");
      if (folderInput.current) folderInput.current.value = "";
      if (zipInput.current) zipInput.current.value = "";
    }
  }

  async function upload() {
    if (!prepared) return;
    setError(null);
    setStatus("uploading");
    try {
      const result = await api.importProject(toImportRequest(prepared, toProjectName(name)));
      router.push(`/projects/${result.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
      setStatus("idle");
    }
  }

  const skippedTotal = prepared ? Object.values(prepared.skipped).reduce((a, b) => a + b, 0) : 0;
  // Problems block the import; notes are information only.
  const problems: string[] = [];
  const notes: string[] = [];
  if (prepared) {
    if (prepared.files.length === 0) problems.push("No files can be imported.");
    if (prepared.files.length > IMPORT_LIMITS.maxFiles) {
      problems.push(`Too many files (${prepared.files.length}; limit ${IMPORT_LIMITS.maxFiles}).`);
    }
    if (prepared.totalBytes > IMPORT_LIMITS.maxTotalBytes) {
      problems.push(`Too large (${formatBytes(prepared.totalBytes)}; limit 25 MB).`);
    }
    if (!prepared.hasPackageJson && prepared.files.length > 0) {
      notes.push(
        prepared.nestedPackageRoots.length > 0
          ? "There is no package.json at the top level, but a subfolder has one. If that subfolder is the actual app, use it as the root below."
          : "No package.json found, so the Tests tab will have nothing to run. You can still describe bugs, get diagnoses and apply fixes.",
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import a project</CardTitle>
        <CardDescription>
          Upload a project from your computer — a folder or a .zip file. It is copied into Bytewise
          as a new project; your original files are not changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            ref={folderInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="Project folder"
            onChange={(e) =>
              e.target.files?.length && void choose(() => prepareFolder(e.target.files!))
            }
          />
          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-label="Project zip file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void choose(() => prepareZip(file));
            }}
          />
          <Button
            variant="outline"
            disabled={status !== "idle"}
            onClick={() => folderInput.current?.click()}
          >
            <FolderUp aria-hidden /> Choose folder
          </Button>
          <Button
            variant="outline"
            disabled={status !== "idle"}
            onClick={() => zipInput.current?.click()}
          >
            <FileArchive aria-hidden /> Choose .zip
          </Button>
        </div>

        {status === "reading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Reading files…
          </p>
        )}

        {prepared && (
          <section aria-label="Import preview" className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium">{prepared.files.length} files</span> ready (
                {formatBytes(prepared.totalBytes)})
                {skippedTotal > 0 && (
                  <span className="text-muted-foreground"> · {skippedTotal} left out</span>
                )}
              </p>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Cancel import"
                onClick={() => setPrepared(null)}
              >
                <X />
              </Button>
            </div>
            {skippedTotal > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(prepared.skipped)
                  .filter(([, n]) => n > 0)
                  .map(([reason, n]) => (
                    <li key={reason}>
                      {n} {reason} file{n === 1 ? "" : "s"} left out
                    </li>
                  ))}
              </ul>
            )}
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Project name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                className="w-full rounded-md border bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            {notes.map((n) => (
              <p key={n} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> {n}
              </p>
            ))}
            {!prepared.hasPackageJson && prepared.nestedPackageRoots.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {prepared.nestedPackageRoots.map((folder) => (
                  <Button
                    key={folder}
                    size="sm"
                    variant="outline"
                    disabled={status !== "idle"}
                    onClick={() => void choose(() => rerootAtSubfolder(prepared, folder))}
                  >
                    <FolderInput aria-hidden /> Use {folder}/ as the project root
                  </Button>
                ))}
              </div>
            )}
            {problems.map((p) => (
              <p key={p} role="alert" className="flex items-start gap-2 text-xs text-warning">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {p}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Dependencies (node_modules) are not imported. Tests that need installed packages may
              not run until they are installed in the project folder.
            </p>
            <Button
              disabled={problems.length > 0 || status !== "idle" || !toProjectName(name)}
              onClick={() => void upload()}
            >
              {status === "uploading" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              Import project
            </Button>
          </section>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
