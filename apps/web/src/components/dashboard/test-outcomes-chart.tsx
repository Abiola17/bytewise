"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { BarChart3, CheckCircle2, Table2, XCircle } from "lucide-react";
import type { TestOutcomes } from "@bytewise/shared";
import { Button } from "@/components/ui/button";

/**
 * Reserved status colors. Outcome is encoded by POSITION (passed above the
 * baseline, not passed below), so color only reinforces it: green/red alone
 * fails colorblind separation. Legend, tooltip and table carry the labels.
 */
const PASSED = "#0ca30c";
const NOT_PASSED = "#d03b3b";

type Row = TestOutcomes["days"][number] & { label: string; notPassed: number; down: number };

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function OutcomeTooltip({ active, payload }: TooltipProps<number, string>) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className="space-y-1 rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">{row.label}</p>
      <p className="flex items-center gap-2">
        <span className="h-0.5 w-3 rounded" style={{ background: PASSED }} aria-hidden />
        <span className="font-semibold tabular-nums">{row.passed}</span>
        <span className="text-muted-foreground">passed</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="h-0.5 w-3 rounded" style={{ background: NOT_PASSED }} aria-hidden />
        <span className="font-semibold tabular-nums">{row.notPassed}</span>
        <span className="text-muted-foreground">
          not passed ({row.failed} failed, {row.timedOut} timed out, {row.error} errors)
        </span>
      </p>
    </div>
  );
}

export function TestOutcomesChart({ data }: { data: TestOutcomes }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const rows: Row[] = data.days.map((d) => {
    const notPassed = d.failed + d.timedOut + d.error;
    return { ...d, label: dayLabel(d.date), notPassed, down: -notPassed };
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.passed, r.notPassed)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: PASSED }} aria-hidden />
            <CheckCircle2 className="size-3.5" aria-hidden /> Passed (above the line)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: NOT_PASSED }} aria-hidden />
            <XCircle className="size-3.5" aria-hidden /> Failed, timed out or error (below)
          </li>
        </ul>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          aria-pressed={view === "table"}
        >
          {view === "chart" ? <Table2 aria-hidden /> : <BarChart3 aria-hidden />}
          {view === "chart" ? "Table" : "Chart"}
        </Button>
      </div>

      {view === "chart" ? (
        <div className="h-56" role="img" aria-label="Verification runs per day by outcome">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              stackOffset="sign"
              margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                domain={[-max, max]}
                tickFormatter={(v: number) => String(Math.abs(v))}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
              <Tooltip
                content={<OutcomeTooltip />}
                cursor={{ fill: "var(--accent)", fillOpacity: 0.5 }}
              />
              <Bar
                dataKey="passed"
                stackId="o"
                fill={PASSED}
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
              />
              <Bar
                dataKey="down"
                stackId="o"
                fill={NOT_PASSED}
                radius={[0, 0, 4, 4]}
                maxBarSize={18}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-56 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <caption className="sr-only">Verification runs per day by outcome</caption>
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Day
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Passed
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Failed
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Timed out
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Error
                </th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {[...rows].reverse().map((r) => (
                <tr key={r.date}>
                  <th scope="row" className="px-3 py-1 text-left font-normal">
                    {r.label}
                  </th>
                  <td className="px-3 py-1 text-right">{r.passed}</td>
                  <td className="px-3 py-1 text-right">{r.failed}</td>
                  <td className="px-3 py-1 text-right">{r.timedOut}</td>
                  <td className="px-3 py-1 text-right">{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
