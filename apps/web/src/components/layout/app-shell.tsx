"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Bug, FolderGit2, History, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { href: "/projects", label: "Projects", icon: FolderGit2, enabled: true },
  { href: "/sessions", label: "Sessions", icon: History, enabled: true },
  { href: "/guide", label: "Guide", icon: BookOpen, enabled: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The IDE (a project or a chat) takes the whole window and has its own navigation.
  if (/^\/(projects|sessions)\/[^/]+/.test(pathname)) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b bg-card/20 md:w-56 md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg border bg-card text-primary">
            <Bug className="size-4" aria-hidden />
          </span>
          <span className="tracking-tight">Bytewise</span>
        </div>
        <nav
          aria-label="Main"
          className="flex flex-wrap gap-1 px-2 pb-2 md:flex-col md:flex-nowrap md:pb-0"
        >
          {navItems.map(({ href, label, icon: Icon, enabled }) =>
            enabled ? (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  pathname === href
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ) : (
              <span
                key={href}
                aria-disabled
                title="Coming in a later phase"
                className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </span>
            ),
          )}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
