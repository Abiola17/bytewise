import Link from "next/link";
import { Bug, FolderGit2, History, LayoutDashboard } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { href: "/projects", label: "Projects", icon: FolderGit2, enabled: true },
  { href: "/sessions", label: "Sessions", icon: History, enabled: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4 font-semibold">
          <Bug className="size-5 text-primary" aria-hidden />
          Bytewise
        </div>
        <nav aria-label="Main" className="flex gap-1 px-2 pb-2 md:flex-col md:pb-0">
          {navItems.map(({ href, label, icon: Icon, enabled }) =>
            enabled ? (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
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
