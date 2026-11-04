import Link from "next/link";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  FileDiff,
  Lightbulb,
  MessageSquarePlus,
  Undo2,
  XCircle,
} from "lucide-react";
import type { DashboardSummary } from "@bytewise/shared";

type Activity = DashboardSummary["recentActivity"][number];

function iconFor(a: Activity) {
  if (a.kind === "session_created") return MessageSquarePlus;
  if (a.kind === "diagnosis") return Lightbulb;
  if (a.kind === "patch") return a.status === "reverted" ? Undo2 : FileDiff;
  switch (a.status) {
    case "passed":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "timed_out":
      return Clock;
    case "blocked":
      return Ban;
    default:
      return AlertCircle;
  }
}

function describe(a: Activity) {
  if (a.kind !== "verification") return a.label;
  const outcome = a.status === "timed_out" ? "timed out" : a.status;
  return `${a.label} ${outcome}`;
}

export function RecentActivity({ items }: { items: Activity[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Activity appears here as you diagnose, patch and verify.
      </p>
    );
  }
  return (
    <ol className="space-y-1">
      {items.map((a) => {
        const Icon = iconFor(a);
        return (
          <li key={a.id}>
            <Link
              href={`/sessions/${a.sessionId}`}
              className="-mx-2 flex items-start gap-3 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{describe(a)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.sessionTitle} · {a.projectName}
                </span>
              </span>
              <time dateTime={a.at} className="shrink-0 text-xs text-muted-foreground">
                {new Date(a.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
