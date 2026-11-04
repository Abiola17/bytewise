"use client";

import { useState } from "react";
import { AlertCircle, Loader2, Search } from "lucide-react";
import type { EvidenceItem, EvidenceResponse } from "@bytewise/shared";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SOURCE_LABELS: Record<EvidenceItem["sourceType"], string> = {
  source_file: "Source",
  test_file: "Test",
  config_file: "Config",
  stack_trace_location: "Stack trace",
  test_output: "Test output",
  screenshot_regions: "Screenshot",
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: EvidenceResponse };

export function EvidencePanel({
  projectId,
  onSelect,
  onEvidenceChange,
}: {
  projectId: string;
  onSelect: (item: EvidenceItem) => void;
  onEvidenceChange: (items: EvidenceItem[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 3) return;
    setState({ status: "loading" });
    try {
      const data = await api.gatherEvidence(projectId, query);
      setState({ status: "success", data });
      onEvidenceChange(data.evidence);
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not gather evidence.",
      });
      onEvidenceChange([]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={submit} className="space-y-2 border-b p-3">
        <label htmlFor="evidence-query" className="text-sm font-medium">
          Describe a bug or paste an error
        </label>
        <textarea
          id="evidence-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={4}
          placeholder="The login endpoint returns 500 for valid credentials…"
          className="w-full resize-y rounded-md border bg-background p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={state.status === "loading" || query.trim().length < 3}
        >
          {state.status === "loading" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Search aria-hidden />
          )}
          Gather evidence
        </Button>
        <p className="text-xs text-muted-foreground">
          Read-only text search of this project. No AI is involved at this step.
        </p>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.status === "idle" && (
          <p className="text-sm text-muted-foreground">
            Evidence appears here: real excerpts from project files, ranked by relevance.
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.message}
          </p>
        )}
        {state.status === "success" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {state.data.terms.map((term) => (
                <Badge key={term} variant="outline" className="font-mono">
                  {term}
                </Badge>
              ))}
            </div>
            {state.data.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching project content was found. Try naming a function, file, or the exact
                error message.
              </p>
            ) : (
              <ul className="space-y-2">
                {state.data.evidence.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className="w-full space-y-1.5 rounded-md border p-2 text-left hover:bg-accent"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs">
                          {item.relativePath}:{item.startLine}–{item.endLine}
                        </span>
                        <Badge variant="default">{SOURCE_LABELS[item.sourceType]}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.reason}</p>
                      <pre className="max-h-28 overflow-hidden rounded bg-background p-2 font-mono text-[11px] leading-snug text-muted-foreground">
                        {item.excerpt}
                      </pre>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {state.data.evidence.length} items · {state.data.budget.usedChars.toLocaleString()} /{" "}
              {state.data.budget.maxTotalChars.toLocaleString()} chars
              {state.data.budget.droppedItems > 0 &&
                ` · ${state.data.budget.droppedItems} lower-ranked items left out by the budget`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
