import { ProjectsOverview } from "@/components/dashboard/projects-overview";

export default function ProjectsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Register a project from the server&apos;s projects directory, then open it to explore
          files and gather evidence.
        </p>
      </header>
      <ProjectsOverview />
    </div>
  );
}
