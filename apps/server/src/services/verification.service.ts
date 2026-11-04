import { randomUUID } from "node:crypto";
import {
  verificationRunSchema,
  type VerificationCommand,
  type VerificationRun,
} from "@bytewise/shared";
import { AppError } from "../errors/app-error";
import { listVerificationCommands, resolveVerificationCommand } from "../execution/command-policy";
import { runProcess, type ProcessResult, type RunLimits } from "../execution/process-runner";
import type { VerificationRunRow } from "../database/schema";
import type { PatchesRepository } from "../repositories/patches.repository";
import type { VerificationsRepository } from "../repositories/verifications.repository";
import type { ProjectService } from "./project.service";
import type { SessionService } from "./session.service";

export function toVerificationDto(row: VerificationRunRow): VerificationRun {
  return verificationRunSchema.parse(row);
}

/** Maps what actually happened to a status. Only exit code 0 counts as passed. */
export function statusFor(result: ProcessResult): VerificationRun["status"] {
  if (result.outcome === "spawn_error") return "error";
  if (result.outcome === "timed_out") return "timed_out";
  if (result.exitCode === 0) return "passed";
  if (result.exitCode === null) return "error"; // killed by a signal, not a test verdict
  return "failed";
}

export function createVerificationService(deps: {
  verifications: VerificationsRepository;
  patches: PatchesRepository;
  sessionService: SessionService;
  projectService: ProjectService;
  limits: RunLimits;
}) {
  const { verifications, patches, sessionService, projectService, limits } = deps;
  const runningProjects = new Set<string>();
  const inFlight = new Set<Promise<void>>();

  async function execute(run: VerificationRunRow, projectId: string, file: string, args: string[]) {
    let result: ProcessResult;
    try {
      result = await runProcess(file, args, { cwd: projectService.rootFor(projectId), limits });
    } catch (error) {
      result = {
        outcome: "spawn_error",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        outputTruncated: false,
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : "The run could not be started.",
      };
    } finally {
      runningProjects.delete(projectId);
    }

    const status = statusFor(result);
    const now = new Date().toISOString();
    // A fix only counts as verified when the run passed with that patch applied.
    const patchStillApplied = run.patchId && patches.find(run.patchId)?.status === "applied";
    const sessionStatus =
      run.patchId && patchStillApplied
        ? status === "passed"
          ? "fix_verified"
          : "verification_failed"
        : undefined;

    verifications.complete(
      run.id,
      {
        status,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        outputTruncated: result.outputTruncated,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        completedAt: now,
      },
      sessionStatus ? { id: run.sessionId, status: sessionStatus, updatedAt: now } : undefined,
    );
  }

  return {
    commandsFor(projectId: string): VerificationCommand[] {
      return listVerificationCommands(projectService.rootFor(projectId));
    },

    listForSession(sessionId: string): VerificationRun[] {
      return verifications.listBySession(sessionId).map(toVerificationDto);
    },

    get(runId: string): VerificationRun {
      const row = verifications.find(runId);
      if (!row) throw new AppError(404, "not_found", "Verification run was not found.");
      return toVerificationDto(row);
    },

    /**
     * Starts an allowed command in the background and returns the `running`
     * record immediately. Blocked commands are recorded without running anything.
     */
    start(sessionId: string, script: string): VerificationRun {
      const session = sessionService.getRow(sessionId);
      const root = projectService.rootFor(session.projectId);
      const resolution = resolveVerificationCommand(root, script);
      const now = new Date().toISOString();
      const applied = patches
        .listBySession(sessionId)
        .filter((p) => p.status === "applied")
        .at(-1);

      const base: VerificationRunRow = {
        id: randomUUID(),
        sessionId,
        patchId: applied?.id ?? null,
        script,
        commandLabel: resolution.allowed ? resolution.command.label : resolution.label,
        status: "running",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        outputTruncated: false,
        errorMessage: null,
        durationMs: null,
        startedAt: now,
        completedAt: null,
      };

      if (!resolution.allowed) {
        const blocked = {
          ...base,
          status: "blocked",
          errorMessage: resolution.reason,
          durationMs: 0,
          completedAt: now,
        };
        verifications.insert(blocked);
        return toVerificationDto(blocked);
      }

      if (runningProjects.has(session.projectId)) {
        throw new AppError(
          409,
          "verification_in_progress",
          "A verification run is already in progress for this project. Wait for it to finish.",
        );
      }
      runningProjects.add(session.projectId);
      verifications.insert(base);

      const { file, args } = resolution.command;
      const job = execute(base, session.projectId, file, args).finally(() => inFlight.delete(job));
      inFlight.add(job);
      return toVerificationDto(base);
    },

    /** Waits for background runs (used on shutdown and in tests). */
    async drain() {
      await Promise.all([...inFlight]);
    },
  };
}

export type VerificationService = ReturnType<typeof createVerificationService>;
