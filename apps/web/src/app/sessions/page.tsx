import { RecentSessions } from "@/components/session/recent-sessions";

export default function SessionsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Each session keeps the conversation, evidence and diagnoses for one problem.
        </p>
      </header>
      <RecentSessions />
    </div>
  );
}
