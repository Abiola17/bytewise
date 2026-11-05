import Link from "next/link";
import { Plus } from "lucide-react";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { ProjectsOverview } from "@/components/dashboard/projects-overview";
import { SystemStatus } from "@/components/dashboard/system-status";
import { RecentSessions } from "@/components/session/recent-sessions";

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Source evidence → AI diagnosis → minimal patch → your approval → real verification.
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden /> Open a project
        </Link>
      </header>

      <DashboardOverview />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <RecentSessions />
        <div className="space-y-6">
          <ProjectsOverview />
          <SystemStatus />
        </div>
      </div>
    </div>
  );
}
