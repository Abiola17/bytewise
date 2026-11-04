"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder } from "lucide-react";
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

function Node({
  node,
  depth,
  selected,
  highlighted,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  highlighted: Set<string>;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.isFile) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        style={indent}
        aria-current={selected === node.path ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm hover:bg-accent",
          selected === node.path && "bg-accent font-medium",
        )}
      >
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{node.name}</span>
        {highlighted.has(node.path) && (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
            title="Has evidence"
          />
        )}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={indent}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-sm text-muted-foreground hover:bg-accent"
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        <Folder className="size-3.5" aria-hidden />
        <span className="truncate">{node.name}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <Node
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            highlighted={highlighted}
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
  onSelect,
}: {
  files: ProjectFile[];
  selected: string | null;
  highlighted: Set<string>;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <nav aria-label="Project files" className="space-y-0.5">
      {tree.map((node) => (
        <Node
          key={node.path}
          node={node}
          depth={0}
          selected={selected}
          highlighted={highlighted}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
