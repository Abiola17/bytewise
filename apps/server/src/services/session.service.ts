import { randomUUID } from "node:crypto";
import {
  debugSessionSchema,
  diagnosisSchema,
  verificationRunSchema,
  type CreateSessionRequest,
  type DebugSession,
  type Diagnosis,
  type SessionDetail,
  type SessionListResponse,
} from "@bytewise/shared";
import { notFound } from "../errors/app-error";
import type { DebugSessionRow, DiagnosisRow } from "../database/schema";
import { listVerificationCommands } from "../execution/command-policy";
import type { PatchesRepository } from "../repositories/patches.repository";
import type { VerificationsRepository } from "../repositories/verifications.repository";
import type { SessionsRepository } from "../repositories/sessions.repository";
import { toScreenshotDto } from "./media.service";
import { toPatchDto } from "./patch-dto";
import type { ProjectService } from "./project.service";

export const DEFAULT_SESSION_TITLE = "New debugging session";

export function toSessionDto(row: DebugSessionRow): DebugSession {
  return debugSessionSchema.parse(row);
}

export function toDiagnosisDto(row: DiagnosisRow): Diagnosis {
  return diagnosisSchema.parse({
    ...row,
    limitations: JSON.parse(row.limitationsJson),
    clarifyingQuestions: JSON.parse(row.clarifyingQuestionsJson),
    evidenceIds: JSON.parse(row.evidenceIdsJson),
    rejectedEvidenceIds: JSON.parse(row.rejectedEvidenceIdsJson),
  });
}

export function createSessionService(deps: {
  sessions: SessionsRepository;
  patches: PatchesRepository;
  verifications: VerificationsRepository;
  projectService: ProjectService;
}) {
  const { sessions, patches, verifications, projectService } = deps;

  return {
    create(projectId: string, input: CreateSessionRequest): DebugSession {
      projectService.get(projectId); // 404 if the project does not exist
      const now = new Date().toISOString();
      return toSessionDto(
        sessions.insertSession({
          id: randomUUID(),
          projectId,
          title: input.title ?? DEFAULT_SESSION_TITLE,
          status: "open",
          createdAt: now,
          updatedAt: now,
        }),
      );
    },

    listByProject(projectId: string): DebugSession[] {
      projectService.get(projectId);
      return sessions.listByProject(projectId).map(toSessionDto);
    },

    listRecent(limit: number): SessionListResponse["sessions"] {
      return sessions
        .listRecent(limit)
        .map(({ session, projectName }) => ({ ...toSessionDto(session), projectName }));
    },

    getRow(sessionId: string): DebugSessionRow {
      const row = sessions.findSession(sessionId);
      if (!row) throw notFound("Debugging session");
      return row;
    },

    detail(sessionId: string): SessionDetail {
      const row = this.getRow(sessionId);
      const project = projectService.get(row.projectId);
      return {
        session: toSessionDto(row),
        project: { id: project.id, name: project.name },
        messages: sessions.messages(sessionId).map((m) => ({
          ...m,
          role: m.role as "user" | "assistant",
        })),
        evidence: sessions.evidence(sessionId).map((e) => ({
          id: e.id,
          sourceType: e.sourceType as SessionDetail["evidence"][number]["sourceType"],
          relativePath: e.relativePath,
          startLine: e.startLine,
          endLine: e.endLine,
          excerpt: e.excerpt,
          reason: e.description,
        })),
        diagnoses: sessions.diagnoses(sessionId).map(toDiagnosisDto),
        patches: patches.listBySession(sessionId).map(toPatchDto),
        verifications: verifications
          .listBySession(sessionId)
          .map((run) => verificationRunSchema.parse(run)),
        verificationCommands: listVerificationCommands(projectService.rootFor(project.id)),
        screenshots: sessions.screenshots(sessionId).map(toScreenshotDto),
      };
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
