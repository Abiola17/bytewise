"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight, FolderGit2, Loader2, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ProjectsOverview() {
  const projects = useApi(api.listProjects);
  const available = useApi(api.listAvailableProjects);
  const [registering, setRegistering] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);

  async function register(directory: string) {
    setRegistering(directory);
    setRegisterError(null);
    try {
      await api.createProject({ directory });
      projects.reload();
      available.reload();
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : "Could not register project.");
    } finally {
      setRegistering(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>Codebases registered for debugging.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {projects.state.status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading projects…
          </p>
        )}
        {projects.state.status === "error" && (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden /> {projects.state.message}
          </p>
        )}
        {projects.state.status === "success" && projects.state.data.projects.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <FolderGit2 className="mx-auto mb-2 size-6" aria-hidden />
            No projects registered yet. Register one below.
          </div>
        )}
        {projects.state.status === "success" && projects.state.data.projects.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Already registered — click a project to open it.
          </p>
        )}
        {projects.state.status === "success" && projects.state.data.projects.length > 0 && (
          <ul className="divide-y">
            {projects.state.data.projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="-mx-2 flex items-center justify-between gap-4 rounded px-2 py-2 text-sm hover:bg-accent"
                >
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{project.language}</Badge>
                    <span className="text-xs text-primary">Open</span>
                    <ChevronRight className="size-4 text-primary" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {available.state.status === "success" && available.state.data.directories.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              Available in the projects directory
            </p>
            <ul className="space-y-1">
              {available.state.data.directories.map((dir) => (
                <li key={dir} className="flex items-center justify-between gap-4 text-sm">
                  <code className="truncate font-mono text-xs">{dir}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={registering !== null}
                    onClick={() => void register(dir)}
                  >
                    {registering === dir ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Plus aria-hidden />
                    )}
                    Register
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {available.state.status === "success" && available.state.data.directories.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
            <p className="min-w-0 flex-1">
              To add another project,{" "}
              <Link href="/projects" className="text-primary hover:underline">
                import it from your computer
              </Link>{" "}
              (folder or .zip) on the Projects page.
            </p>
            <Button size="sm" variant="ghost" onClick={available.reload}>
              <RefreshCw aria-hidden /> Check again
            </Button>
          </div>
        )}
        {registerError && (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden /> {registerError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
