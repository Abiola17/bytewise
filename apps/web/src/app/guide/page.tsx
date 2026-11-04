import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  FileDiff,
  FlaskConical,
  FolderGit2,
  ImagePlus,
  Lightbulb,
  MessageSquare,
  Mic,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    icon: FolderGit2,
    title: "Register and open the project",
    where: "Sidebar → Projects",
    body: [
      "Click Register next to broken-login-app, then click its name to open it.",
      "Already in the list (no Register button)? It is registered already — just click it.",
      "To debug your own code instead, use Import a project at the top of the Projects page.",
      "The project page shows its files (secrets and dependencies are hidden) and a read-only code viewer.",
    ],
  },
  {
    icon: MessageSquare,
    title: "Start a debugging session",
    where: "Project page → New debugging session (top right)",
    body: [
      "The session page has a chat on the left and four tabs on the right: Diagnosis, Patch, Tests and Evidence.",
      "A Next step bar under the title always tells you what to do.",
    ],
  },
  {
    icon: FlaskConical,
    title: "Run the tests first",
    where: "Tests tab → Run",
    body: [
      "The result shows Failed — the bug is real. The real output appears below it.",
      "That output is also given to the AI as evidence.",
    ],
  },
  {
    icon: Mic,
    title: "Describe the bug",
    where: "Chat box → send (or ⌘/Ctrl + Enter)",
    body: [
      'For example: "The login endpoint returns a 500 error when a user submits valid credentials."',
      "Or click the microphone, speak, and click it again. Your words appear in the box for you to check — they are not sent until you press send.",
      "Wait 10–30 seconds while Bytewise gathers evidence and asks the model.",
    ],
  },
  {
    icon: Lightbulb,
    title: "Read the diagnosis",
    where: "Diagnosis tab",
    body: [
      "Likely cause, suggested fix, the evidence it is based on (click to see the code), and what it is unsure about.",
      "It is labelled AI hypothesis · not verified: an informed guess, not a proven fact. If the AI needs more detail it asks questions — answer them in the chat.",
    ],
  },
  {
    icon: FileDiff,
    title: "Review and apply the fix",
    where: "Patch tab → Propose a fix",
    body: [
      "You see which files would change and a before/after view. Proposing changes nothing.",
      "Apply patch → Confirm and apply writes the change. Reject patch discards it.",
    ],
  },
  {
    icon: CheckCircle2,
    title: "Verify",
    where: "Tests tab → Run",
    body: [
      "Passed (with patch applied) means the fix works, and the session shows Fix verified.",
      "If it fails, click Diagnose this failure and continue from the diagnosis.",
    ],
  },
  {
    icon: Undo2,
    title: "Reset the demo",
    where: "Patch tab → Revert patch",
    body: ["Restores the original code, bug included, so you can run the demo again."],
  },
];

const LABELS = [
  ["Observed evidence", "Copied directly from your files, test output or screenshot. Real."],
  ["AI hypothesis · not verified", "The model's explanation. It may be wrong."],
  ["Passed / Failed", "What actually happened when the test command ran. Real."],
  ["Fix verified", "Tests passed while the fix was applied."],
  ["Blocked", "That command is not allowed, so nothing ran."],
  ["Timed out", "The command took over 2 minutes and was stopped."],
];

const NEVER = [
  "Change a file without your Apply patch → Confirm and apply.",
  "Edit your tests, package.json or lockfiles as part of a fix.",
  "Run a command the AI suggests — only your project's test, lint, typecheck or check scripts.",
  "Show a passing result that did not really happen.",
  "Send your API keys to the browser or to your project's code.",
];

const TROUBLE = [
  ["Server unreachable", "Run pnpm dev in the bytewise folder."],
  ["API key missing", "Add META_API_KEY to .env and restart pnpm dev."],
  ["The model could not propose a safe patch", "Add detail in the chat, then Propose a fix again."],
  ["…changed after the patch was proposed", "Click Propose a new fix."],
  ["Microphone access was denied", "Allow the microphone for localhost in browser settings."],
  ["The demo tests already pass", "The fix is still applied — use Revert patch."],
];

export default function GuidePage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">How Bytewise works</h1>
        <p className="text-sm text-muted-foreground">
          You describe a bug. Bytewise finds the relevant code, an AI suggests the likely cause and
          a small fix, <strong className="text-foreground">you</strong> decide whether to apply it,
          and Bytewise runs the project&apos;s real tests to show whether it worked.
        </p>
        <p className="rounded-md border bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
          Describe the bug → evidence → AI diagnosis → proposed fix → you approve → real test run
        </p>
      </header>

      <section aria-labelledby="walkthrough" className="space-y-3">
        <h2 id="walkthrough" className="text-lg font-semibold">
          Walkthrough: fix the demo login bug
        </h2>
        <p className="text-sm text-muted-foreground">
          The included demo app <code className="font-mono">broken-login-app</code> returns an error
          (HTTP 500) even with the right password. Follow these steps — the{" "}
          <Link href="/" className="text-primary hover:underline">
            Dashboard
          </Link>{" "}
          ticks them off as you go.
        </p>
        <ol className="space-y-3">
          {STEPS.map(({ icon: Icon, title, where, body }, i) => (
            <li key={title}>
              <Card>
                <CardHeader className="flex-row items-start gap-3 pb-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
                    </CardTitle>
                    <p className="font-mono text-xs text-primary">{where}</p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 pl-15 text-sm text-muted-foreground">
                  {body.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="screenshots" className="space-y-2">
        <h2 id="screenshots" className="flex items-center gap-2 text-lg font-semibold">
          <ImagePlus className="size-5" aria-hidden /> Adding a screenshot (optional)
        </h2>
        <p className="text-sm text-muted-foreground">
          In a session, open the Evidence tab → Add a screenshot of the bug. Choose an image, type a
          concrete noun such as <em>button</em> or <em>text box</em>, and click Find regions with
          SAM 3.1. The matching areas are outlined and added to the evidence for the next diagnosis.
        </p>
      </section>

      <section aria-labelledby="own-project" className="space-y-2">
        <h2 id="own-project" className="flex items-center gap-2 text-lg font-semibold">
          <FolderGit2 className="size-5" aria-hidden /> Using your own project
        </h2>
        <p className="text-sm text-muted-foreground">
          On the Projects page, use <strong>Import a project</strong> → Choose folder (or Choose
          .zip), check the preview and click Import project. Bytewise copies it in as a new project;
          your original files are not changed. A <code className="font-mono">package.json</code> is
          optional — without one (e.g. a plain HTML/CSS/JS site) you can still diagnose and fix; it
          is only needed, with a <code className="font-mono">test</code> script, for the Tests tab.
          If it lives in a subfolder, the preview offers to use that folder as the root.
          Dependencies (node_modules), secrets such as <code className="font-mono">.env</code> and
          files over 1 MB are left out.
        </p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="labels" className="space-y-2">
          <h2 id="labels" className="text-lg font-semibold">
            What the labels mean
          </h2>
          <dl className="space-y-2 text-sm">
            {LABELS.map(([term, meaning]) => (
              <div key={term} className="rounded-md border p-2">
                <dt className="font-medium">{term}</dt>
                <dd className="text-muted-foreground">{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="never" className="space-y-2">
          <h2 id="never" className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="size-5" aria-hidden /> Bytewise will never
          </h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {NEVER.map((line) => (
              <li key={line} className="flex gap-2">
                <Ban className="mt-0.5 size-4 shrink-0" aria-hidden /> {line}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="trouble" className="space-y-2">
        <h2 id="trouble" className="text-lg font-semibold">
          If something goes wrong
        </h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  You see
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  What to do
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {TROUBLE.map(([seen, fix]) => (
                <tr key={seen}>
                  <td className="px-3 py-2">{seen}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
