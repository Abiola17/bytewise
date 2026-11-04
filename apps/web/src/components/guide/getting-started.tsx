import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Circle } from "lucide-react";
import type { DashboardSummary } from "@bytewise/shared";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Step {
  title: string;
  how: string;
  done: boolean;
  href?: string;
}

/** Each step is ticked from stored records, so the checklist shows real progress. */
function steps(s: DashboardSummary): Step[] {
  const executedRuns = s.verificationRuns.total - s.verificationRuns.blocked;
  return [
    {
      title: "Register a project",
      how: "Projects → click Register next to broken-login-app. Already listed? It is registered — skip ahead.",
      done: s.projects > 0,
      href: "/projects",
    },
    {
      title: "Start a debugging session",
      how: "Open the project → click New debugging session (top right).",
      done: s.sessions.total > 0,
      href: "/projects",
    },
    {
      title: "Run the tests to see the bug",
      how: "In the session, open the Tests tab → click Run. Expect Failed.",
      done: executedRuns > 0,
    },
    {
      title: "Describe the bug and get a diagnosis",
      how: "Type (or dictate) the problem in the chat and send it. Read the Diagnosis tab.",
      done: s.diagnoses > 0,
    },
    {
      title: "Review and apply a fix",
      how: "Patch tab → Propose a fix → check the diff → Apply patch → Confirm and apply.",
      done: s.patches.applied > 0,
    },
    {
      title: "Verify the fix",
      how: "Tests tab → Run again. Passed means the session becomes Fix verified.",
      done: s.sessions.fixVerified > 0,
    },
  ];
}

export function GettingStarted({ summary }: { summary: DashboardSummary }) {
  const list = steps(summary);
  const next = list.findIndex((step) => !step.done);
  const doneCount = list.filter((step) => step.done).length;
  const recentSession = summary.recentActivity[0]?.sessionId;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            {next === -1
              ? "You have completed the whole loop. Use Revert patch in a session to run the demo again."
              : `Fix the demo bug in six steps — ${doneCount} of ${list.length} done.`}
          </CardDescription>
        </div>
        <Link
          href="/guide"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <BookOpen className="size-4" aria-hidden /> Full guide
        </Link>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {list.map((step, i) => {
            const isNext = i === next;
            // Steps 3–6 happen inside a session: link to the latest one once it exists.
            const href = step.href ?? (recentSession ? `/sessions/${recentSession}` : undefined);
            const body = (
              <>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {step.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span>
                    {i + 1}. {step.title}
                  </span>
                  <span className="sr-only">{step.done ? "(done)" : "(not done)"}</span>
                  {isNext && (
                    <span className="ml-auto rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      Next
                    </span>
                  )}
                </span>
                <span className="mt-1 block pl-6 text-xs text-muted-foreground">{step.how}</span>
              </>
            );
            const className = cn(
              "block h-full rounded-md border p-3",
              isNext && "border-primary bg-primary/5",
              step.done && "opacity-70",
            );
            return (
              <li key={step.title}>
                {isNext && href ? (
                  <Link href={href} className={cn(className, "hover:bg-accent")}>
                    {body}
                    <span className="mt-2 flex items-center gap-1 pl-6 text-xs text-primary">
                      Go there <ArrowRight className="size-3" aria-hidden />
                    </span>
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
