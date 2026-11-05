"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Bug,
  ChevronRight,
  Code2,
  FolderTree,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  PanelBottom,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import type {
  FileListResponse,
  HealthResponse,
  PatchProposal,
  Project,
  SessionDetail,
  SessionListResponse,
  VerificationCommand,
} from "@bytewise/shared";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LineRange } from "@/components/project/code-viewer";
import { AgentChat } from "./agent-chat";
import { isFileEvidence, type PatchAction, type StoredEvidence } from "./chat-cards";
import { EditorArea, tabKey, type EditorTab, type FileEntry } from "./editor-area";
import { ResizeHandle, usePersistentSize } from "./resize-handle";
import {
  SESSION_STATUS_LABEL,
  SIDEBAR_VIEWS,
  Sidebar,
  sessionStatusVariant,
  type SidebarView,
} from "./sidebar";
import { TerminalPanel } from "./terminal-panel";

const POLL_INTERVAL_MS = 1000;
/** Mirrors the server's execution policy, only to offer buttons before a chat exists. */
const ALLOWED_SCRIPT = /^(test|test:[\w.-]+|typecheck|type-check|lint|check|build)$/;

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type MobilePane = "files" | "editor" | "chat";

/**
 * The Bytewise IDE: files on the left, code and diffs in the middle, real test
 * output below, and the agent chat on the right. Every change and command is
 * proposed in the chat and only happens after the developer accepts it.
 */
export function IdeWorkspace({
  projectId: projectIdProp,
  sessionId: sessionIdProp,
  initialFile = null,
}: {
  projectId?: string;
  sessionId?: string;
  initialFile?: { path: string; range: LineRange | null } | null;
}) {
  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(projectIdProp ?? null);
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileListResponse | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionListResponse["sessions"]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Editor
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [fileCache, setFileCache] = useState<Record<string, FileEntry>>({});
  const [highlights, setHighlights] = useState<Record<string, LineRange | null>>({});
  const cacheRef = useRef(fileCache);
  cacheRef.current = fileCache;

  // Layout
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const [sidebarWidth, setSidebarWidth, sidebarLimits] = usePersistentSize("bytewise.sidebar", 260, 180, 480);
  const [chatWidth, setChatWidth, chatLimits] = usePersistentSize("bytewise.chat", 440, 340, 760);
  const [terminalHeight, setTerminalHeight, terminalLimits] = usePersistentSize("bytewise.terminal", 240, 120, 600);

  // Actions
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [patchBusy, setPatchBusy] = useState<PatchAction | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [runStarting, setRunStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const loadSession = useCallback(async (id: string) => {
    const d = await api.getSession(id);
    setDetail(d);
    setProjectId(d.project.id);
    return d;
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!projectId) return;
    try {
      const { sessions: all } = await api.listSessions();
      setSessions(all.filter((s) => s.projectId === projectId));
    } catch {
      // The chat list is secondary; the workspace still works without it.
    }
  }, [projectId]);

  useEffect(() => {
    if (!sessionIdProp) return;
    loadSession(sessionIdProp).catch((e) => setLoadError(message(e, "Could not load the chat.")));
  }, [sessionIdProp, loadSession]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.getProject(projectId).then(
      (p) => !cancelled && setProject(p),
      (e) => !cancelled && setLoadError(message(e, "Could not open the project.")),
    );
    api.listFiles(projectId).then(
      (f) => !cancelled && setFiles(f),
      (e) => !cancelled && setFilesError(message(e, "Could not list files.")),
    );
    void refreshSessions();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshSessions]);

  useEffect(() => {
    api.health().then(setHealth, () => setHealth(null));
  }, []);

  // Poll while a verification run is in progress; stop once it finishes.
  const hasRunning = detail?.verifications.some((v) => v.status === "running") ?? false;
  useEffect(() => {
    if (!hasRunning || !sessionId) return;
    const timer = setInterval(() => void loadSession(sessionId).catch(() => {}), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, sessionId, loadSession]);

  /** Opens (or refreshes) a file tab. Content always comes from the server. */
  const openFile = useCallback(
    async (
      path: string,
      range: LineRange | null = null,
      opts: { reload?: boolean; activate?: boolean; reveal?: boolean } = {},
    ) => {
      if (!projectId) return;
      const { reload = false, activate = true, reveal = true } = opts;
      if (activate) {
        setTabs((t) => (t.some((x) => x.kind === "file" && x.path === path) ? t : [...t, { kind: "file", path }]));
        setActiveKey(`file:${path}`);
        setHighlights((h) => ({ ...h, [path]: range }));
        if (reveal) setMobilePane("editor");
      }
      if (!reload && cacheRef.current[path]?.status === "success") return;
      if (!cacheRef.current[path]) setFileCache((c) => ({ ...c, [path]: { status: "loading" } }));
      try {
        const file = await api.readFile(projectId, path);
        setFileCache((c) => ({ ...c, [path]: { status: "success", file } }));
      } catch (e) {
        setFileCache((c) => ({ ...c, [path]: { status: "error", message: message(e, "Could not read the file.") } }));
      }
    },
    [projectId],
  );

  // Open a first file once the list arrives, so the editor is never blank by accident.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (!files || openedInitial.current) return;
    openedInitial.current = true;
    if (initialFile) {
      void openFile(initialFile.path, initialFile.range, { reveal: false });
      return;
    }
    const first =
      files.files.find((f) => /^readme\.md$/i.test(f.path)) ??
      files.files.find((f) => f.path === "package.json") ??
      files.files[0];
    if (first) void openFile(first.path, null, { reveal: false });
  }, [files, initialFile, openFile]);

  function openDiff(patch: PatchProposal, path: string) {
    const tab: EditorTab = { kind: "diff", patchId: patch.id, path };
    const key = tabKey(tab);
    setTabs((t) => (t.some((x) => tabKey(x) === key) ? t : [...t, tab]));
    setActiveKey(key);
    setMobilePane("editor");
  }

  function closeTab(key: string) {
    setTabs((current) => {
      const index = current.findIndex((t) => tabKey(t) === key);
      const next = current.filter((t) => tabKey(t) !== key);
      if (key === activeKey) {
        const neighbour = next[Math.min(index, next.length - 1)];
        setActiveKey(neighbour ? tabKey(neighbour) : null);
      }
      return next;
    });
  }

  const closeDiffTabs = (patchId?: string) =>
    setTabs((current) => {
      const next = current.filter((t) => t.kind !== "diff" || (patchId && t.patchId !== patchId));
      setActiveKey((key) => (next.some((t) => tabKey(t) === key) ? key : next[next.length - 1] ? tabKey(next[next.length - 1]!) : null));
      return next;
    });

  function openEvidence(item: StoredEvidence) {
    if (isFileEvidence(item)) {
      void openFile(item.relativePath, { startLine: item.startLine, endLine: item.endLine });
    } else if (item.sourceType === "test_output") {
      setTerminalOpen(true);
      setMobilePane("editor");
    } else {
      setSidebarView("evidence");
      setSidebarOpen(true);
      setMobilePane("files");
    }
  }

  /** Creates the chat on first use and moves the URL to it without a reload. */
  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    if (!projectId) throw new Error("No project is open.");
    const session = await api.createSession(projectId);
    setSessionId(session.id);
    window.history.replaceState(null, "", `/sessions/${session.id}`);
    return session.id;
  }

  async function send(content: string): Promise<boolean> {
    setChatError(null);
    // A new message brings a new diagnosis; earlier patch errors no longer apply.
    setProposeError(null);
    setPatchError(null);
    setPending(content);
    setSending(true);
    let id: string | null = sessionId;
    try {
      id = await ensureSession();
      const d = await api.postMessage(id, content);
      setDetail(d);
      // Show the code the diagnosis relies on, like a teammate pointing at the line.
      const diagnosis = d.diagnoses[d.diagnoses.length - 1];
      const first = diagnosis?.evidenceIds
        .map((eid) => d.evidence.find((e) => e.id === eid))
        .find((e): e is StoredEvidence => Boolean(e && isFileEvidence(e)));
      if (first) {
        void openFile(first.relativePath, { startLine: first.startLine, endLine: first.endLine }, { reveal: false });
      }
      void refreshSessions();
      return true;
    } catch (e) {
      setChatError(message(e, "The request failed."));
      if (!id) return false;
      // The server keeps the user message when the model fails; show what it stored.
      const stored = await loadSession(id).catch(() => null);
      const last = stored?.messages[stored.messages.length - 1];
      return last?.role === "user" && last.content.trim() === content.trim();
    } finally {
      setPending(null);
      setSending(false);
    }
  }

  async function retry() {
    if (!sessionId) return;
    setChatError(null);
    setSending(true);
    try {
      setDetail(await api.retryDiagnosis(sessionId));
    } catch (e) {
      setChatError(message(e, "The request failed."));
      await loadSession(sessionId).catch(() => {});
    } finally {
      setSending(false);
    }
  }

  async function patchAction(action: PatchAction, patchId?: string) {
    if (!sessionId) return;
    setPatchBusy(action);
    if (action === "propose") setProposeError(null);
    else setPatchError(null);
    try {
      if (action === "propose") {
        const patch = await api.proposePatch(sessionId);
        if (patch.files[0]) openDiff(patch, patch.files[0].path);
      } else if (patchId) {
        const patch =
          action === "approve"
            ? await api.approvePatch(patchId)
            : action === "reject"
              ? await api.rejectPatch(patchId)
              : await api.revertPatch(patchId);
        if (action !== "reject") {
          // Files on disk changed: refresh every open copy from the server.
          for (const f of patch.files) {
            if (cacheRef.current[f.path]) void openFile(f.path, null, { reload: true, activate: false });
          }
        }
        if (action === "reject" || patch.status === "applied") closeDiffTabs(patchId);
        if (patch.status === "applied" && patch.files[0]) {
          void openFile(patch.files[0].path, null, { reload: true, reveal: false });
        }
      }
    } catch (e) {
      const text = message(e, "The patch action failed.");
      if (action === "propose") setProposeError(text);
      else setPatchError(text);
    } finally {
      await loadSession(sessionId).catch(() => {});
      setPatchBusy(null);
    }
  }

  async function startRun(script: string) {
    setTerminalOpen(true);
    setRunStarting(true);
    setRunError(null);
    let id: string | null = sessionId;
    try {
      id = await ensureSession();
      const run = await api.startVerification(id, script);
      setSelectedRunId(run.id);
      void refreshSessions();
    } catch (e) {
      setRunError(message(e, "Could not start the run."));
    } finally {
      if (id) await loadSession(id).catch(() => {});
      setRunStarting(false);
    }
  }

  function newChat() {
    if (sending) return;
    setSessionId(null);
    setDetail(null);
    setChatError(null);
    setPatchError(null);
    setProposeError(null);
    setRunError(null);
    setSelectedRunId(null);
    closeDiffTabs();
    setMobilePane("chat");
    if (projectId) window.history.replaceState(null, "", `/projects/${projectId}`);
  }

  function openSession(id: string) {
    if (sending || id === sessionId) return;
    setSessionId(id);
    setChatError(null);
    setPatchError(null);
    setProposeError(null);
    setRunError(null);
    setSelectedRunId(null);
    closeDiffTabs();
    setMobilePane("chat");
    window.history.replaceState(null, "", `/sessions/${id}`);
    loadSession(id).catch((e) => setChatError(message(e, "Could not load the chat.")));
  }

  const knownFiles = useMemo(() => new Set(files?.files.map((f) => f.path) ?? []), [files]);
  const evidencePaths = useMemo(
    () => new Set(detail?.evidence.filter(isFileEvidence).map((e) => e.relativePath) ?? []),
    [detail],
  );
  const modifiedPaths = useMemo(
    () =>
      new Set(
        detail?.patches.filter((p) => p.status === "applied").flatMap((p) => p.files.map((f) => f.path)) ?? [],
      ),
    [detail],
  );
  const commands: VerificationCommand[] = useMemo(
    () =>
      detail?.verificationCommands ??
      (project?.metadata.scripts ?? [])
        .filter((s) => ALLOWED_SCRIPT.test(s))
        .map((s) => ({ script: s, label: s, definition: "package.json script" })),
    [detail, project],
  );

  if (loadError && !project) {
    return (
      <div role="alert" className="flex h-dvh items-center justify-center p-8">
        <div className="max-w-sm space-y-3 text-center text-sm">
          <AlertCircle className="mx-auto size-6 text-destructive" aria-hidden />
          <p>{loadError}</p>
          <Link href="/projects" className="text-primary hover:underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }
  if (!project || !projectId) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Opening workspace…
        </p>
      </div>
    );
  }

  const activeTab = tabs.find((t) => tabKey(t) === activeKey);
  const runs = detail?.verifications ?? [];
  const modelLabel = health ? `${health.modelProvider.model}` : null;
  const toggleView = (view: SidebarView) => {
    if (sidebarOpen && sidebarView === view) setSidebarOpen(false);
    else {
      setSidebarView(view);
      setSidebarOpen(true);
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Title bar */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-panel px-2 text-sm">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 font-semibold tracking-tight hover:bg-accent"
          title="Dashboard"
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bug className="size-3.5" aria-hidden />
          </span>
          <span className="hidden sm:inline">Bytewise</span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <Link href="/projects" className="hidden text-muted-foreground hover:text-foreground sm:inline">
          Projects
        </Link>
        <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/60 sm:block" aria-hidden />
        <h1 className="shrink-0 font-medium">{project.name}</h1>
        {detail && (
          <>
            <span className="text-muted-foreground/50">/</span>
            <span className="min-w-0 truncate text-muted-foreground" title={detail.session.title}>
              {detail.session.title}
            </span>
            <Badge variant={sessionStatusVariant(detail.session.status)} className="shrink-0">
              {SESSION_STATUS_LABEL[detail.session.status]}
            </Badge>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <div className="hidden items-center gap-0.5 lg:flex">
            <PanelToggle label="Toggle sidebar" active={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)} icon={PanelLeft} />
            <PanelToggle label="Toggle terminal" active={terminalOpen} onClick={() => setTerminalOpen((v) => !v)} icon={PanelBottom} />
            <PanelToggle label="Toggle chat" active={chatOpen} onClick={() => setChatOpen((v) => !v)} icon={PanelRight} />
          </div>
          <Button size="sm" variant="outline" className="ml-1.5 h-7" onClick={newChat} disabled={sending}>
            <MessageSquarePlus aria-hidden /> <span className="hidden sm:inline">New chat</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav aria-label="Workspace views" className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r bg-panel py-2 lg:flex">
          {SIDEBAR_VIEWS.map(({ id, label, icon: Icon }) => {
            const active = sidebarOpen && sidebarView === id;
            const count = id === "evidence" ? detail?.evidence.length ?? 0 : 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleView(id)}
                aria-label={label}
                aria-pressed={active}
                title={label}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
                  active && "text-foreground",
                )}
              >
                {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-1.5 w-0.5 rounded-full bg-primary" />}
                <Icon className="size-[18px]" aria-hidden />
                {count > 0 && (
                  <span className="absolute top-1 right-0.5 min-w-3.5 rounded-full bg-primary px-1 text-[9px] leading-3.5 font-semibold text-primary-foreground">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <div className="mt-auto flex flex-col items-center gap-1">
            <Link href="/" aria-label="Dashboard" title="Dashboard" className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
              <LayoutDashboard className="size-[18px]" aria-hidden />
            </Link>
            <Link href="/guide" aria-label="Guide" title="Guide" className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
              <BookOpen className="size-[18px]" aria-hidden />
            </Link>
          </div>
        </nav>

        {/* Sidebar */}
        <aside
          style={{ "--w": `${sidebarWidth}px` } as React.CSSProperties}
          className={cn(
            "min-h-0 w-full shrink-0 flex-col lg:w-[var(--w)]",
            mobilePane === "files" ? "flex" : "hidden",
            sidebarOpen ? "lg:flex" : "lg:hidden",
          )}
        >
          <Sidebar
            view={sidebarView}
            projectId={projectId}
            projectName={project.name}
            files={files}
            filesError={filesError}
            selectedPath={activeTab?.path ?? null}
            evidencePaths={evidencePaths}
            modifiedPaths={modifiedPaths}
            detail={detail}
            sessions={sessions}
            onOpenFile={(p, range) => void openFile(p, range)}
            onOpenEvidence={openEvidence}
            onOpenSession={openSession}
            onNewChat={newChat}
            onScreenshotUploaded={async () => {
              if (sessionId) await loadSession(sessionId);
            }}
            onClose={() => setSidebarOpen(false)}
          />
        </aside>
        {sidebarOpen && (
          <ResizeHandle
            axis="x"
            label="Resize sidebar"
            value={sidebarWidth}
            {...sidebarLimits}
            direction={1}
            onChange={setSidebarWidth}
            className="hidden lg:block"
          />
        )}

        {/* Editor + terminal */}
        <main
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            mobilePane === "editor" ? "flex" : "hidden",
            "lg:flex",
          )}
        >
          <div className="min-h-0 flex-1">
            <EditorArea
              tabs={tabs}
              activeKey={activeKey}
              files={fileCache}
              highlights={highlights}
              patches={detail?.patches ?? []}
              onActivate={setActiveKey}
              onClose={closeTab}
            />
          </div>
          {terminalOpen && (
            <>
              <ResizeHandle
                axis="y"
                label="Resize terminal"
                value={terminalHeight}
                {...terminalLimits}
                direction={-1}
                onChange={setTerminalHeight}
              />
              <div style={{ height: terminalHeight }} className="shrink-0">
                <TerminalPanel
                  runs={runs}
                  selectedId={selectedRunId}
                  commands={commands}
                  otherScripts={(project.metadata.scripts ?? []).filter(
                    (s) => !commands.some((c) => c.script === s),
                  )}
                  starting={runStarting}
                  error={runError}
                  disabled={false}
                  onSelect={setSelectedRunId}
                  onRun={(s) => void startRun(s)}
                  onClose={() => setTerminalOpen(false)}
                />
              </div>
            </>
          )}
        </main>

        {/* Chat */}
        {chatOpen && (
          <ResizeHandle
            axis="x"
            label="Resize chat"
            value={chatWidth}
            {...chatLimits}
            direction={-1}
            onChange={setChatWidth}
            className="hidden lg:block"
          />
        )}
        <section
          aria-label="Bytewise chat"
          style={{ "--w": `${chatWidth}px` } as React.CSSProperties}
          className={cn(
            "min-h-0 w-full shrink-0 flex-col lg:w-[var(--w)]",
            mobilePane === "chat" ? "flex" : "hidden",
            chatOpen ? "lg:flex" : "lg:hidden",
          )}
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-panel px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <MessageSquare className="size-3.5" aria-hidden />
            <span className="flex-1">Chat</span>
            <button
              type="button"
              onClick={() => {
                toggleView("chats");
                setMobilePane("files");
              }}
              className="rounded px-1.5 py-0.5 font-normal tracking-normal normal-case hover:bg-accent hover:text-foreground"
            >
              History
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <AgentChat
              projectName={project.name}
              detail={detail}
              knownFiles={knownFiles}
              pending={pending}
              sending={sending}
              chatError={chatError}
              onSend={send}
              onRetry={() => void retry()}
              onOpenFile={(p, line) => void openFile(p, line ? { startLine: line, endLine: line } : null)}
              onOpenEvidence={openEvidence}
              patchBusy={patchBusy}
              patchError={patchError}
              proposeError={proposeError}
              onPatchAction={(a, id) => void patchAction(a, id)}
              onOpenDiff={openDiff}
              commands={commands}
              runStarting={runStarting}
              runError={runError}
              onRun={(s) => void startRun(s)}
              onShowRun={(id) => {
                setSelectedRunId(id);
                setTerminalOpen(true);
                setMobilePane("editor");
              }}
              onAttachScreenshot={() => {
                setSidebarView("evidence");
                setSidebarOpen(true);
                setMobilePane("files");
              }}
              modelLabel={modelLabel}
            />
          </div>
        </section>
      </div>

      {/* Mobile pane switcher */}
      <nav aria-label="Panes" className="grid shrink-0 grid-cols-3 border-t bg-panel lg:hidden">
        {(
          [
            ["files", "Files", FolderTree],
            ["editor", "Code", Code2],
            ["chat", "Chat", MessageSquare],
          ] as const
        ).map(([pane, label, Icon]) => (
          <button
            key={pane}
            type="button"
            onClick={() => setMobilePane(pane)}
            aria-pressed={mobilePane === pane}
            className={cn(
              "flex flex-col items-center gap-0.5 py-1.5 text-[11px] text-muted-foreground",
              mobilePane === pane && "text-primary",
            )}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </nav>

      {/* Status bar */}
      <footer className="hidden h-6 shrink-0 items-center gap-4 border-t bg-panel px-3 text-[11px] text-muted-foreground lg:flex">
        <span className="flex items-center gap-1.5">
          <FolderTree className="size-3" aria-hidden /> {project.name}
        </span>
        <span>{project.language}</span>
        {files && <span>{files.files.length} files</span>}
        {modifiedPaths.size > 0 && <span className="text-warning">{modifiedPaths.size} modified</span>}
        <button type="button" onClick={() => setTerminalOpen((v) => !v)} className="hover:text-foreground">
          {runs.length > 0 ? `${runs.length} run${runs.length === 1 ? "" : "s"}` : "No runs yet"}
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          {health ? (
            <>
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", health.modelProvider.configured ? "bg-success" : "bg-warning")}
              />
              {health.modelProvider.name} · {health.modelProvider.model}
              {!health.modelProvider.configured && <span className="text-warning">· API key missing</span>}
            </>
          ) : (
            <span className="text-warning">Server unreachable</span>
          )}
        </span>
      </footer>
    </div>
  );
}

function PanelToggle({
  label,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: typeof PanelLeft;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent",
        active ? "text-foreground" : "text-muted-foreground/60",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
