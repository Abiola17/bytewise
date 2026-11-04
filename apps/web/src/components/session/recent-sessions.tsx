"use client";

import Link from "next/link";
import { AlertCircle, ChevronRight, History, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_VARIANT = {
  open: "outline",
  diagnosed: "success",
  needs_information: "warning",
  patch_proposed: "warning",
  patch_applied: "default",
  fix_verified: "success",
  verification_failed: "destructive",
  closed: "outline",
} as const;

export function RecentSessions() {
  const { state } = useApi(api.listSessions);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent sessions</CardTitle>
        <CardDescription>Your latest debugging sessions across projects.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading sessions…
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden /> {state.message}
          </p>
        )}
        {state.status === "success" && state.data.sessions.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <History className="mx-auto mb-2 size-6" aria-hidden />
            No debugging sessions yet. Open a project and start one.
          </div>
        )}
        {state.status === "success" && state.data.sessions.length > 0 && (
          <ul className="divide-y">
            {state.data.sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="-mx-2 flex items-center gap-3 rounded px-2 py-2 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.projectName} · {new Date(s.updatedAt).toLocaleString()}
                    </span>
                  </span>
                  <Badge variant={STATUS_VARIANT[s.status]}>{s.status.replaceAll("_", " ")}</Badge>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
