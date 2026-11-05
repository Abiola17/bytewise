"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Files,
  History,
  Layers,
  Loader2,
  MessageSquarePlus,
  Search,
  X,
} from "lucide-react";
import type {
  FileListResponse,
  SearchResponse,
  SessionDetail,
  SessionListResponse,
} from "@bytewise/shared";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FileIcon, FileTree } from "@/components/project/file-tree";
import { ScreenshotPanel } from "@/components/screenshots/screenshot-panel";
import { evidenceLabel, isFileEvidence, type StoredEvidence } from "./chat-cards";
import type { LineRange } from "@/components/project/code-viewer";

export type SidebarView = "files" | "search" | "evidence" | "chats";

export const SIDEBAR_VIEWS: { id: SidebarView; label: string; icon: typeof Files }[] = [
  { id: "files", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "evidence", label: "Evidence", icon: Layers },
  { id: "chats", label: "Chats", icon: History },
];

export const SESSION_STATUS_LABEL: Record<SessionDetail["session"]["status"], string> = {
  open: "Open",
  diagnosed: "Diagnosed",
  needs_information: "Needs information",
  patch_proposed: "Patch proposed",
  patch_applied: "Patch applied",
  fix_verified: "Fix verified",
  verification_failed: "Verification failed",
  closed: "Closed",
};

export const sessionStatusVariant = (status: SessionDetail["session"]["status"]) =>
  status === "fix_verified"
    ? ("success" as const)
    : status === "verification_failed"
      ? ("destructive" as const)
      : status === "patch_proposed" || status === "needs_information"
        ? ("warning" as const)
        : ("outline" as const);

function PaneHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="flex-1 truncate">{title}</span>
      {children}
    </div>
  );
}

function FilterInput({
  value,
  onChange,
  placeholder,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative px-2 pb-2">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-[calc(50%+4px)] text-muted-foreground" aria-hidden />
      <input
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border bg-background/60 pr-7 pl-7 text-xs placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-3.5 -translate-y-[calc(50%+4px)] text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function SearchView({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (path: string, range: LineRange | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "done"; data: SearchResponse }
  >({ status: "idle" });

  // Debounced literal text search across the project's allowed files.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(projectId, q).then(
        (data) => !cancelled && setState({ status: "done", data }),
        (e: unknown) =>
          !cancelled &&
          setState({ status: "error", message: e instanceof Error ? e.message : "Search failed." }),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, projectId]);

  const grouped = new Map<string, SearchResponse["matches"]>();
  if (state.status === "done") {
    for (const m of state.data.matches) grouped.set(m.path, [...(grouped.get(m.path) ?? []), m]);
  }

  return (
    <>
      <FilterInput value={query} onChange={setQuery} placeholder="Search text in files" label="Search files" autoFocus />
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {state.status === "loading" && (
          <p className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching…
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="px-3 py-1 text-xs text-destructive">
            {state.message}
          </p>
        )}
        {state.status === "done" && state.data.matches.length === 0 && (
          <p className="px-3 py-1 text-xs text-muted-foreground">No results.</p>
        )}
        {[...grouped].map(([path, matches]) => (
          <div key={path} className="mb-1">
            <p className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium">
              <FileIcon path={path} />
              <span className="truncate">{path}</span>
              <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {matches.length}
              </span>
            </p>
            {matches.map((m) => (
              <button
                key={`${m.line}:${m.column}`}
                type="button"
                onClick={() => onOpenFile(m.path, { startLine: m.line, endLine: m.line })}
                className="flex w-full gap-2 py-0.5 pr-2 pl-8 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <span className="w-6 shrink-0 text-right tabular-nums">{m.line}</span>
                <span className="truncate">{m.preview.trim()}</span>
              </button>
            ))}
          </div>
        ))}
        {state.status === "done" && state.data.truncated && (
          <p className="px-3 py-1 text-xs text-warning">More results exist; refine the search.</p>
        )}
      </div>
    </>
  );
}

function EvidenceView({
  detail,
  onOpenEvidence,
  onScreenshotUploaded,
}: {
  detail: SessionDetail | null;
  onOpenEvidence: (item: StoredEvidence) => void;
  onScreenshotUploaded: () => Promise<void>;
}) {
  if (!detail) {
    return (
      <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        When you ask about a bug, the code Bytewise reads to answer appears here, with real file
        paths and line numbers.
      </p>
    );
  }
  const latest = detail.diagnoses[detail.diagnoses.length - 1];
  const cited = new Set(latest?.evidenceIds ?? []);
  const items = [...detail.evidence].sort(
    (a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)),
  );
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
      <p className="px-1 text-[11px] text-muted-foreground">
        Observed evidence · read from project files ({items.length})
      </p>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpenEvidence(item)}
          disabled={!isFileEvidence(item)}
          className="block w-full overflow-hidden rounded-lg border bg-card/50 text-left transition-colors hover:border-primary/40 disabled:cursor-default"
        >
          <span className="flex items-center gap-1.5 border-b px-2 py-1.5">
            {isFileEvidence(item) && <FileIcon path={item.relativePath} />}
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{evidenceLabel(item)}</span>
            {cited.has(item.id) && <Badge variant="default">cited</Badge>}
          </span>
          <pre className="max-h-24 overflow-hidden px-2 py-1.5 font-mono text-[10.5px] leading-snug text-muted-foreground">
            {item.excerpt}
          </pre>
          <span className="block px-2 pb-1.5 text-[10.5px] text-muted-foreground/80">{item.reason}</span>
        </button>
      ))}
      <div className="pt-2">
        <ScreenshotPanel
          sessionId={detail.session.id}
          screenshots={detail.screenshots}
          onUploaded={onScreenshotUploaded}
        />
      </div>
    </div>
  );
}

function ChatsView({
  sessions,
  activeId,
  onOpen,
  onNew,
}: {
  sessions: SessionListResponse["sessions"];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <button
        type="button"
        onClick={onNew}
        className="mb-2 flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
      >
        <MessageSquarePlus className="size-3.5" aria-hidden /> New chat
      </button>
      {sessions.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">No chats for this project yet.</p>
      )}
      <ul className="space-y-0.5">
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              aria-current={s.id === activeId ? "true" : undefined}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left hover:bg-accent",
                s.id === activeId && "bg-accent",
              )}
            >
              <span className="block truncate text-[13px]">{s.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant={sessionStatusVariant(s.status)}>{SESSION_STATUS_LABEL[s.status]}</Badge>
                {new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sidebar({
  view,
  projectId,
  projectName,
  files,
  filesError,
  selectedPath,
  evidencePaths,
  modifiedPaths,
  detail,
  sessions,
  onOpenFile,
  onOpenEvidence,
  onOpenSession,
  onNewChat,
  onScreenshotUploaded,
  onClose,
}: {
  view: SidebarView;
  projectId: string;
  projectName: string;
  files: FileListResponse | null;
  filesError: string | null;
  selectedPath: string | null;
  evidencePaths: Set<string>;
  modifiedPaths: Set<string>;
  detail: SessionDetail | null;
  sessions: SessionListResponse["sessions"];
  onOpenFile: (path: string, range: LineRange | null) => void;
  onOpenEvidence: (item: StoredEvidence) => void;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  onScreenshotUploaded: () => Promise<void>;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const title = SIDEBAR_VIEWS.find((v) => v.id === view)!.label;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <PaneHeader title={view === "files" ? `${title} · ${projectName}` : title}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide sidebar"
          className="rounded p-0.5 hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </PaneHeader>

      {view === "files" && (
        <>
          <FilterInput value={filter} onChange={setFilter} placeholder="Filter files" label="Filter files" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!files && !filesError && (
              <p className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Listing files…
              </p>
            )}
            {filesError && (
              <p role="alert" className="flex items-center gap-2 px-3 py-1 text-xs text-destructive">
                <AlertCircle className="size-3.5" aria-hidden /> {filesError}
              </p>
            )}
            {files && (
              <FileTree
                files={files.files}
                selected={selectedPath}
                highlighted={evidencePaths}
                modified={modifiedPaths}
                filter={filter}
                onSelect={(p) => onOpenFile(p, null)}
              />
            )}
          </div>
          <p className="border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {files?.truncated && <span className="block text-warning">File list truncated.</span>}
            Dependencies, build output, secrets and binaries are hidden.{" "}
            <Link href="/projects" className="text-primary hover:underline">
              Upload another project
            </Link>
          </p>
        </>
      )}
      {view === "search" && <SearchView projectId={projectId} onOpenFile={onOpenFile} />}
      {view === "evidence" && (
        <EvidenceView detail={detail} onOpenEvidence={onOpenEvidence} onScreenshotUploaded={onScreenshotUploaded} />
      )}
      {view === "chats" && (
        <ChatsView
          sessions={sessions}
          activeId={detail?.session.id ?? null}
          onOpen={onOpenSession}
          onNew={onNewChat}
        />
      )}
    </div>
  );
}
