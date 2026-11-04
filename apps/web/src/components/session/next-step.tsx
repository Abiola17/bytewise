import { ArrowRight, Lightbulb } from "lucide-react";
import type { SessionDetail } from "@bytewise/shared";
import { Button } from "@/components/ui/button";

export type SessionTab = "diagnosis" | "patch" | "tests" | "evidence";

interface Hint {
  text: string;
  action?: { label: string; tab: SessionTab };
}

/** What to do next, derived from what the backend says has happened in this session. */
function hintFor(detail: SessionDetail): Hint {
  const { status } = detail.session;
  const hasMessages = detail.messages.length > 0;
  const hasRuns = detail.verifications.some((v) => v.status !== "blocked");

  switch (status) {
    case "open":
      if (hasMessages) {
        return {
          text: "Waiting for a diagnosis. If it failed, press Retry diagnosis in the chat.",
        };
      }
      return hasRuns
        ? { text: "Now describe the bug in the chat on the left and send it." }
        : {
            text: "Start by running the tests to see the bug, or describe it in the chat on the left.",
            action: { label: "Run tests", tab: "tests" },
          };
    case "needs_information":
      return {
        text: "The AI needs more detail. Answer its questions in the chat.",
        action: { label: "See questions", tab: "diagnosis" },
      };
    case "diagnosed":
      return {
        text: "Read the diagnosis, then ask for a fix in the Patch tab.",
        action: { label: "Propose a fix", tab: "patch" },
      };
    case "patch_proposed":
      return {
        text: "A fix is waiting. Review the changes, then Apply or Reject it. Nothing has changed yet.",
        action: { label: "Review patch", tab: "patch" },
      };
    case "patch_applied":
      return {
        text: "The fix is applied but not tested. Run the tests to verify it.",
        action: { label: "Run tests", tab: "tests" },
      };
    case "fix_verified":
      return {
        text: "Done — the tests pass with the fix applied. To demo again, use Revert patch.",
        action: { label: "Open Patch tab", tab: "patch" },
      };
    case "verification_failed":
      return {
        text: "The tests still fail with the fix applied. Open Tests and click Diagnose this failure.",
        action: { label: "See results", tab: "tests" },
      };
    case "closed":
      return { text: "This session is closed." };
  }
}

export function NextStep({
  detail,
  onGoTo,
}: {
  detail: SessionDetail;
  onGoTo: (tab: SessionTab) => void;
}) {
  const hint = hintFor(detail);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-primary/5 px-4 py-2 text-sm"
    >
      <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Next step: </span>
        {hint.text}
      </span>
      {hint.action && (
        <Button size="sm" variant="outline" onClick={() => onGoTo(hint.action!.tab)}>
          {hint.action.label} <ArrowRight aria-hidden />
        </Button>
      )}
    </div>
  );
}
