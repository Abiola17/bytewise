"use client";

import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function StatusRow({
  label,
  ok,
  okText,
  badText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <Badge variant="success">
          <CheckCircle2 aria-hidden /> {okText}
        </Badge>
      ) : (
        <Badge variant="warning">
          <AlertCircle aria-hidden /> {badText}
        </Badge>
      )}
    </div>
  );
}

export function SystemStatus() {
  const { state, reload } = useApi(api.health);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>System status</CardTitle>
          <CardDescription>Live check of the Bytewise server.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={reload} aria-label="Refresh status">
          <RefreshCw />
        </Button>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking server…
          </p>
        )}
        {state.status === "error" && (
          <div role="alert" className="space-y-1 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="size-4" aria-hidden /> Server unreachable
            </p>
            <p className="text-muted-foreground">
              {state.message} Start it with <code className="font-mono">pnpm dev</code>.
            </p>
          </div>
        )}
        {state.status === "success" && (
          <div className="divide-y">
            <StatusRow
              label="API server"
              ok
              okText={`Online · v${state.data.version}`}
              badText=""
            />
            <StatusRow
              label="Database"
              ok={state.data.database === "ok"}
              okText="Connected"
              badText="Unavailable"
            />
            <StatusRow
              label={`Model (${state.data.modelProvider.name} · ${state.data.modelProvider.model})`}
              ok={state.data.modelProvider.configured}
              okText="API key set"
              badText="API key missing"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
