import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../database/client";
import {
  debugSessions,
  diagnoses,
  evidence,
  messages,
  projects,
  screenshots,
  type DebugSessionRow,
  type DiagnosisRow,
  type EvidenceRow,
  type MessageRow,
  type ScreenshotRow,
} from "../database/schema";

export function createSessionsRepository(db: Db) {
  return {
    insertSession(row: DebugSessionRow): DebugSessionRow {
      return db.insert(debugSessions).values(row).returning().get();
    },

    findSession(id: string): DebugSessionRow | undefined {
      return db.select().from(debugSessions).where(eq(debugSessions.id, id)).get();
    },

    listByProject(projectId: string): DebugSessionRow[] {
      return db
        .select()
        .from(debugSessions)
        .where(eq(debugSessions.projectId, projectId))
        .orderBy(desc(debugSessions.updatedAt))
        .all();
    },

    listRecent(limit: number) {
      return db
        .select({ session: debugSessions, projectName: projects.name })
        .from(debugSessions)
        .innerJoin(projects, eq(projects.id, debugSessions.projectId))
        .orderBy(desc(debugSessions.updatedAt))
        .limit(limit)
        .all();
    },

    messages(sessionId: string): MessageRow[] {
      return db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.createdAt))
        .all();
    },

    evidence(sessionId: string): EvidenceRow[] {
      return db
        .select()
        .from(evidence)
        .where(eq(evidence.sessionId, sessionId))
        .orderBy(asc(evidence.createdAt))
        .all();
    },

    diagnoses(sessionId: string): DiagnosisRow[] {
      return db
        .select()
        .from(diagnoses)
        .where(eq(diagnoses.sessionId, sessionId))
        .orderBy(asc(diagnoses.createdAt))
        .all();
    },

    screenshots(sessionId: string): ScreenshotRow[] {
      return db
        .select()
        .from(screenshots)
        .where(eq(screenshots.sessionId, sessionId))
        .orderBy(asc(screenshots.createdAt))
        .all();
    },

    insertMessage(row: MessageRow): MessageRow {
      return db.insert(messages).values(row).returning().get();
    },

    insertEvidence(rows: EvidenceRow[]) {
      if (rows.length === 0) return;
      // Identical content yields an identical id, so re-retrieved evidence is kept once.
      db.insert(evidence).values(rows).onConflictDoNothing().run();
    },

    /** Stores a diagnosis with its assistant message and updates the session, atomically. */
    recordDiagnosis(input: {
      diagnosis: DiagnosisRow;
      message: MessageRow;
      session: { id: string; status: string; title?: string; updatedAt: string };
    }) {
      db.transaction((tx) => {
        tx.insert(diagnoses).values(input.diagnosis).run();
        tx.insert(messages).values(input.message).run();
        tx.update(debugSessions)
          .set({
            status: input.session.status,
            updatedAt: input.session.updatedAt,
            ...(input.session.title ? { title: input.session.title } : {}),
          })
          .where(eq(debugSessions.id, input.session.id))
          .run();
      });
    },

    touchSession(id: string, updatedAt: string) {
      db.update(debugSessions).set({ updatedAt }).where(eq(debugSessions.id, id)).run();
    },
  };
}

export type SessionsRepository = ReturnType<typeof createSessionsRepository>;
