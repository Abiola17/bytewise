import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { SessionDetail } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type StoredEvidence = SessionDetail["evidence"][number];

const SOURCE_LABELS: Record<StoredEvidence["sourceType"], string> = {
  source_file: "Source",
  test_file: "Test",
  config_file: "Config",
  stack_trace_location: "Stack trace",
  test_output: "Test output",
  screenshot_regions: "Screenshot",
};

/** Evidence that is not a project file: no line numbers, nothing to open. */
const isFileEvidence = (item: StoredEvidence) =>
  item.sourceType !== "test_output" && item.sourceType !== "screenshot_regions";

/** One observed-evidence excerpt, shown with its real line numbers. */
export function EvidenceCard({
  item,
  projectId,
  cited,
  active,
}: {
  item: StoredEvidence;
  projectId: string;
  cited: boolean;
  active: boolean;
}) {
  const lines = item.excerpt.split("\n");
  const href = `/projects/${projectId}?path=${encodeURIComponent(item.relativePath)}&start=${item.startLine}&end=${item.endLine}`;

  return (
    <article
      id={`evidence-${item.id}`}
      className={cn(
        "scroll-mt-4 rounded-md border bg-card transition-colors",
        active && "border-primary ring-1 ring-primary",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {isFileEvidence(item)
            ? `${item.relativePath}:${item.startLine}–${item.endLine}`
            : item.relativePath}
        </span>
        <Badge variant="default">{SOURCE_LABELS[item.sourceType]}</Badge>
        {cited && <Badge variant="success">Cited</Badge>}
        {isFileEvidence(item) && (
          <Link
            href={href}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Open ${item.relativePath} in the project`}
            title="Open in project"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        )}
      </header>
      <p className="px-3 pt-2 text-xs text-muted-foreground">{item.reason}</p>
      <pre className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        {isFileEvidence(item) ? (
          lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="mr-3 w-8 shrink-0 select-none text-right text-muted-foreground/60">
                {item.startLine + i}
              </span>
              <span className="whitespace-pre">{line}</span>
            </div>
          ))
        ) : (
          <span className="whitespace-pre-wrap">{item.excerpt}</span>
        )}
      </pre>
    </article>
  );
}
