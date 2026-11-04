import { AlertTriangle, HelpCircle, Lightbulb, Sparkles, Wand2 } from "lucide-react";
import type { Diagnosis, SessionDetail } from "@bytewise/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CONFIDENCE_VARIANT = { low: "warning", medium: "default", high: "success" } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h4>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function DiagnosisPanel({
  diagnosis,
  evidence,
  onSelectEvidence,
  onProposeFix,
}: {
  diagnosis: Diagnosis | undefined;
  evidence: SessionDetail["evidence"];
  onSelectEvidence: (id: string) => void;
  onProposeFix: () => void;
}) {
  if (!diagnosis) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="mx-auto mb-2 size-6" aria-hidden />
        Describe a bug in the chat. Bytewise will gather evidence from the project and propose a
        diagnosis here.
      </div>
    );
  }

  const byId = new Map(evidence.map((e) => [e.id, e]));

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning">
          <Lightbulb aria-hidden /> AI hypothesis · not verified
        </Badge>
        {diagnosis.confidence && (
          <Badge variant={CONFIDENCE_VARIANT[diagnosis.confidence]}>
            Confidence: {diagnosis.confidence}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {diagnosis.provider} · {diagnosis.model}
        </span>
      </div>

      {diagnosis.kind === "needs_information" ? (
        <>
          <Field label="More information needed">{diagnosis.summary}</Field>
          {diagnosis.clarifyingQuestions.length > 0 && (
            <Field label="Questions">
              <ul className="space-y-1">
                {diagnosis.clarifyingQuestions.map((q) => (
                  <li key={q} className="flex gap-2">
                    <HelpCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {q}
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Summary">{diagnosis.summary}</Field>
          {diagnosis.likelyCause && <Field label="Likely cause">{diagnosis.likelyCause}</Field>}
          {diagnosis.suggestedFix && <Field label="Suggested fix">{diagnosis.suggestedFix}</Field>}
        </>
      )}

      <Field label="Supporting evidence">
        {diagnosis.evidenceIds.length === 0 ? (
          <p className="text-muted-foreground">No retrieved evidence was cited.</p>
        ) : (
          <ul className="space-y-1">
            {diagnosis.evidenceIds.map((id) => {
              const item = byId.get(id);
              if (!item) return null;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelectEvidence(id)}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {item.sourceType === "test_output" || item.sourceType === "screenshot_regions"
                      ? item.relativePath
                      : `${item.relativePath}:${item.startLine}–${item.endLine}`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Field>

      {diagnosis.uncertainty && <Field label="Uncertainty">{diagnosis.uncertainty}</Field>}

      {diagnosis.limitations.length > 0 && (
        <Field label="Limitations">
          <ul className="space-y-1">
            {diagnosis.limitations.map((l) => (
              <li key={l} className="flex gap-2 text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        </Field>
      )}

      <div className="space-y-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <p>This diagnosis has not changed any files and no tests have been run.</p>
        {diagnosis.kind === "diagnosis" && (
          <Button size="sm" variant="outline" onClick={onProposeFix}>
            <Wand2 aria-hidden /> Review a proposed fix
          </Button>
        )}
      </div>
    </div>
  );
}
