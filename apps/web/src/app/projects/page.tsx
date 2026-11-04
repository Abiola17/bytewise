import { ProjectsOverview } from "@/components/dashboard/projects-overview";
import { ImportProject } from "@/components/project/import-project";

export default function ProjectsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Import a project from your computer, or open one that is already registered.
        </p>
      </header>
      <ImportProject />
      <ProjectsOverview />
    </div>
  );
}
