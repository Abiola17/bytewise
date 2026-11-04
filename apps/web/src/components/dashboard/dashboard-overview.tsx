"use client";

import { useCallback } from "react";
import { AlertCircle, FlaskConical, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentActivity } from "./recent-activity";
import { SummaryCards } from "./summary-cards";
import { TestOutcomesChart } from "./test-outcomes-chart";

const CHART_DAYS = 14;

function Loading({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Loading {what}…
    </p>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="size-4" aria-hidden /> {message}
    </p>
  );
}

export function DashboardOverview() {
  const summary = useApi(api.dashboardSummary);
  const outcomes = useApi(useCallback(() => api.testOutcomes(CHART_DAYS), []));

  return (
    <div className="space-y-6">
      {summary.state.status === "loading" && <Loading what="metrics" />}
      {summary.state.status === "error" && <Failure message={summary.state.message} />}
      {summary.state.status === "success" && <SummaryCards summary={summary.state.data} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Verification outcomes</CardTitle>
            <CardDescription>Real test runs per day, last {CHART_DAYS} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {outcomes.state.status === "loading" && <Loading what="test outcomes" />}
            {outcomes.state.status === "error" && <Failure message={outcomes.state.message} />}
            {outcomes.state.status === "success" &&
              (outcomes.state.data.totalRuns === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <FlaskConical className="mx-auto mb-2 size-6" aria-hidden />
                  No test runs in the last {CHART_DAYS} days. Run tests from a debugging
                  session&apos;s Tests tab to see outcomes here.
                </div>
              ) : (
                <TestOutcomesChart data={outcomes.state.data} />
              ))}
            <p className="mt-3 text-xs text-muted-foreground">
              Shows whether commands exited successfully — not proof that code is correct.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Diagnoses, patches and test runs.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.state.status === "loading" && <Loading what="activity" />}
            {summary.state.status === "error" && <Failure message={summary.state.message} />}
            {summary.state.status === "success" && (
              <RecentActivity items={summary.state.data.recentActivity} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
