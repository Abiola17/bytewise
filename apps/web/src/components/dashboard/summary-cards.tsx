import { CheckCircle2, History, ShieldCheck, XCircle } from "lucide-react";
import type { DashboardSummary } from "@bytewise/shared";

function Tile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof History;
}) {
  return (
    <div role="group" aria-label={label} className="rounded-lg border bg-card p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

/** Headline counts. Every number is a count of stored records. */
export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const runs = summary.verificationRuns;
  const notPassed = runs.failed + runs.timedOut + runs.error;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Debugging sessions"
        value={summary.sessions.total}
        detail={`${summary.patches.proposed} patch${summary.patches.proposed === 1 ? "" : "es"} proposed`}
        icon={History}
      />
      <Tile
        label="Verified fixes"
        value={summary.sessions.fixVerified}
        detail="Tests passed with the patch applied"
        icon={ShieldCheck}
      />
      <Tile
        label="Test runs passed"
        value={runs.passed}
        detail={`of ${runs.total - runs.blocked} executed`}
        icon={CheckCircle2}
      />
      <Tile
        label="Test runs not passed"
        value={notPassed}
        detail={`${runs.failed} failed · ${runs.timedOut} timed out · ${runs.error} errors`}
        icon={XCircle}
      />
    </div>
  );
}
