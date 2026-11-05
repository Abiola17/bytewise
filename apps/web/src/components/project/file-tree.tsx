"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen } from "lucide-react";
import type { ProjectFile } from "@bytewise/shared";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], isFile: false };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const nodePath = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part && c.isFile === isFile);
      if (!child) {
        child = { name: part, path: nodePath, children: [], isFile };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const ext = path.split(".").pop()?.toLowerCase();
  const Icon = ext === "json" ? FileJson : ext === "md" || ext === "txt" ? FileText : FileCode2;
  const color =
    ext === "ts" || ext === "tsx"
      ? "text-sky-400"
      : ext === "js" || ext === "mjs" || ext === "cjs" || ext === "jsx"
        ? "text-yellow-300"
        : ext === "json"
          ? "text-amber-400"
          : ext === "css"
            ? "text-pink-400"
            : "text-muted-foreground";
  return <Icon className={cn("size-3.5 shrink-0", color, className)} aria-hidden />;
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  selected: string | null;
  highlighted: Set<string>;
  modified: Set<string>;
  forceOpen: boolean;
  onSelect: (path: string) => void;
}

function Node({ node, depth, selected, highlighted, modified, forceOpen, onSelect }: NodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.isFile) {
    const isModified = modified.has(node.path);
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        style={indent}
        aria-current={selected === node.path ? "true" : undefined}
        className={cn(
          "flex h-[26px] w-full items-center gap-1.5 pr-2 text-left text-[13px] text-foreground/85 hover:bg-accent",
          selected === node.path && "bg-primary/12 text-foreground ring-1 ring-inset ring-primary/30",
        )}
      >
        <span className="w-3.5 shrink-0" />
        <FileIcon path={node.path} />
        <span className={cn("truncate", isModified && "text-warning")}>{node.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {highlighted.has(node.path) && (
            <span className="size-1.5 rounded-full bg-primary" title="Used as evidence" />
          )}
          {isModified && (
            <span className="font-mono text-[10px] font-semibold text-warning" title="Modified by an applied patch">
              M
            </span>
          )}
        </span>
      </button>
    );
  }

  const expanded = open || forceOpen;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        style={indent}
        aria-expanded={expanded}
        className="flex h-[26px] w-full items-center gap-1.5 pr-2 text-left text-[13px] text-foreground/75 hover:bg-accent"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-primary/80" aria-hidden />
        ) : (
          <Folder className="size-3.5 shrink-0 text-primary/80" aria-hidden />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded &&
        node.children.map((child) => (
          <Node
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            highlighted={highlighted}
            modified={modified}
            forceOpen={forceOpen}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function FileTree({
  files,
  selected,
  highlighted,
  modified = new Set(),
  filter = "",
  onSelect,
}: {
  files: ProjectFile[];
  selected: string | null;
  highlighted: Set<string>;
  modified?: Set<string>;
  /** Case-insensitive path filter; matching folders are expanded. */
  filter?: string;
  onSelect: (path: string) => void;
}) {
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (needle ? files.filter((f) => f.path.toLowerCase().includes(needle)) : files),
    [files, needle],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  return (
    <nav aria-label="Project files" className="py-1">
      {tree.map((node) => (
        <Node
          key={node.path}
          node={node}
          depth={0}
          selected={selected}
          highlighted={highlighted}
          modified={modified}
          forceOpen={needle.length > 0}
          onSelect={onSelect}
        />
      ))}
      {needle && visible.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">No files match “{filter}”.</p>
      )}
    </nav>
  );
}
