import { randomUUID } from "node:crypto";
import type { SessionDetail } from "@bytewise/shared";
import { AppError, badRequest, conflict } from "../errors/app-error";
import { createHash } from "node:crypto";
import type { EvidenceItem } from "@bytewise/shared";
import type { SessionsRepository } from "../repositories/sessions.repository";
import type { VerificationsRepository } from "../repositories/verifications.repository";
import type { DiagnosisService } from "./diagnosis.service";
import type { ProjectFilesService } from "./project-files.service";
import type { ProjectService } from "./project.service";
import { DEFAULT_SESSION_TITLE, type SessionService } from "./session.service";

/** Number of earlier user turns folded into the evidence search query. */
const EVIDENCE_QUERY_TURNS = 3;
/** How much of a failed run's output is offered to the model as evidence. */
const TEST_OUTPUT_MAX_LINES = 80;
const TEST_OUTPUT_MAX_CHARS = 6000;
const MAX_SCREENSHOT_EVIDENCE = 3;

/**
 * The output of the latest verification run, if it did not pass, as observed
 * evidence. This is real captured output, never model-generated.
 */
function testOutputEvidence(
  run: ReturnType<VerificationsRepository["listBySession"]>[number] | undefined,
): EvidenceItem | null {
  if (!run || !["failed", "timed_out", "error"].includes(run.status)) return null;
  const combined = [run.stdout, run.stderr, run.errorMessage ?? ""].filter(Boolean).join("\n");
  const all = combined.split("\n");
  // Errors are often logged at the start and the summary is at the end: keep both.
  const headCount = Math.floor(TEST_OUTPUT_MAX_LINES * 0.4);
  const lines =
    all.length <= TEST_OUTPUT_MAX_LINES
      ? all
      : [
          ...all.slice(0, headCount),
          `…[${all.length - TEST_OUTPUT_MAX_LINES} lines omitted]…`,
          ...all.slice(-(TEST_OUTPUT_MAX_LINES - headCount)),
        ];
  while (lines.join("\n").length > TEST_OUTPUT_MAX_CHARS && lines.length > 1) {
    lines.splice(Math.floor(lines.length / 2), 1);
  }
  const excerpt = lines.join("\n");
  if (!excerpt.trim()) return null;
  const id = `ev_${createHash("sha1").update(`run:${run.id}\n${excerpt}`).digest("hex").slice(0, 12)}`;
  return {
    id,
    sourceType: "test_output",
    relativePath: `verification: ${run.commandLabel}`,
    startLine: 1,
    endLine: lines.length,
    excerpt,
    reason: `Output of the latest verification run (${run.status}, exit code ${run.exitCode ?? "none"}).`,
    score: 200,
  };
}

/**
 * Orchestrates a debugging turn: store the request, gather evidence, ask the
 * model for a diagnosis, validate it and persist the outcome.
 */
export function createDebuggingService(deps: {
  sessions: SessionsRepository;
  verifications: VerificationsRepository;
  sessionService: SessionService;
  projectService: ProjectService;
  projectFiles: ProjectFilesService;
  diagnosisService: DiagnosisService;
}) {
  const {
    sessions,
    verifications,
    sessionService,
    projectService,
    projectFiles,
    diagnosisService,
  } = deps;
  const inFlight = new Set<string>();

  async function diagnose(sessionId: string): Promise<SessionDetail> {
    const session = sessionService.getRow(sessionId);
    if (session.status === "closed") throw conflict("This debugging session is closed.");

    const history = sessions.messages(sessionId);
    const last = history[history.length - 1];
    if (!last || last.role !== "user") {
      throw badRequest("There is no unanswered request to diagnose. Send a message first.");
    }

    const project = projectService.get(session.projectId);
    const userTurns = history.filter((m) => m.role === "user").map((m) => m.content);
    const testOutput = testOutputEvidence(verifications.listBySession(sessionId).at(-1));
    // Failing output is searched too: its stack traces point at the exact lines.
    const evidenceQuery = [...userTurns.slice(-EVIDENCE_QUERY_TURNS).reverse(), testOutput?.excerpt]
      .filter(Boolean)
      .join("\n\n");
    const gathered = await projectFiles.gatherEvidence(project.id, evidenceQuery);
    // Screenshot regions the developer attached are observed evidence too.
    const screenshotEvidence = sessions
      .evidence(sessionId)
      .filter((e) => e.sourceType === "screenshot_regions")
      .slice(-MAX_SCREENSHOT_EVIDENCE)
      .map((e) => ({
        id: e.id,
        sourceType: "screenshot_regions" as const,
        relativePath: e.relativePath,
        startLine: e.startLine,
        endLine: e.endLine,
        excerpt: e.excerpt,
        reason: e.description,
        score: 150,
      }));
    const evidence = [
      ...(testOutput ? [testOutput] : []),
      ...screenshotEvidence,
      ...gathered.evidence,
    ];

    const now = () => new Date().toISOString();
    sessions.insertEvidence(
      evidence.map((e) => ({
        id: e.id,
        sessionId,
        sourceType: e.sourceType,
        relativePath: e.relativePath,
        startLine: e.startLine,
        endLine: e.endLine,
        excerpt: e.excerpt,
        description: e.reason,
        createdAt: now(),
      })),
    );

    const result = await diagnosisService.diagnose({
      project: {
        name: project.name,
        language: project.language,
        scripts: project.metadata.scripts,
      },
      conversation: history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      evidence,
    });

    const diagnosisId = randomUUID();
    const timestamp = now();
    const firstRequest = userTurns[0] ?? "";
    sessions.recordDiagnosis({
      diagnosis: {
        id: diagnosisId,
        sessionId,
        kind: result.kind,
        summary: result.summary,
        likelyCause: result.likelyCause,
        confidence: result.confidence,
        uncertainty: result.uncertainty,
        suggestedFix: result.suggestedFix,
        limitationsJson: JSON.stringify(result.limitations),
        clarifyingQuestionsJson: JSON.stringify(result.clarifyingQuestions),
        evidenceIdsJson: JSON.stringify(result.evidenceIds),
        rejectedEvidenceIdsJson: JSON.stringify(result.rejectedEvidenceIds),
        provider: result.provider,
        model: result.model,
        createdAt: timestamp,
      },
      message: {
        id: randomUUID(),
        sessionId,
        role: "assistant",
        content: result.reply,
        diagnosisId,
        createdAt: timestamp,
      },
      session: {
        id: sessionId,
        status: result.kind === "diagnosis" ? "diagnosed" : "needs_information",
        updatedAt: timestamp,
        title:
          session.title === DEFAULT_SESSION_TITLE
            ? firstRequest.replace(/\s+/g, " ").trim().slice(0, 80)
            : undefined,
      },
    });

    return sessionService.detail(sessionId);
  }

  /** Runs `fn` unless a model call is already running for this session. */
  async function exclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    if (inFlight.has(sessionId)) {
      throw new AppError(
        409,
        "diagnosis_in_progress",
        "A diagnosis is already running for this session.",
      );
    }
    inFlight.add(sessionId);
    try {
      return await fn();
    } finally {
      inFlight.delete(sessionId);
    }
  }

  return {
    /** Stores a user message, then diagnoses. The message is kept even if the model call fails. */
    async postMessage(sessionId: string, content: string): Promise<SessionDetail> {
      return exclusive(sessionId, async () => {
        const session = sessionService.getRow(sessionId);
        if (session.status === "closed") throw conflict("This debugging session is closed.");
        const createdAt = new Date().toISOString();
        sessions.insertMessage({
          id: randomUUID(),
          sessionId,
          role: "user",
          content,
          diagnosisId: null,
          createdAt,
        });
        sessions.touchSession(sessionId, createdAt);
        return diagnose(sessionId);
      });
    },

    /** Re-runs diagnosis for the latest unanswered request (e.g. after a provider error). */
    async retryDiagnosis(sessionId: string): Promise<SessionDetail> {
      return exclusive(sessionId, () => diagnose(sessionId));
    },
  };
}

export type DebuggingService = ReturnType<typeof createDebuggingService>;
