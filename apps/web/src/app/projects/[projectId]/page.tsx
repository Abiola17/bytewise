import { ProjectWorkspace } from "@/components/project/project-workspace";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ path?: string; start?: string; end?: string }>;
}) {
  const { projectId } = await params;
  const { path, start, end } = await searchParams;
  const startLine = Number(start);
  const endLine = Number(end);
  const initialFile = path
    ? {
        path,
        range:
          Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0
            ? { startLine, endLine: Math.max(startLine, endLine) }
            : null,
      }
    : null;

  return <ProjectWorkspace projectId={projectId} initialFile={initialFile} />;
}
