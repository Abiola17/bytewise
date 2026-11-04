import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../database/client";
import { debugSessions, verificationRuns, type VerificationRunRow } from "../database/schema";

export function createVerificationsRepository(db: Db) {
  return {
    find(id: string): VerificationRunRow | undefined {
      return db.select().from(verificationRuns).where(eq(verificationRuns.id, id)).get();
    },

    listBySession(sessionId: string): VerificationRunRow[] {
      return db
        .select()
        .from(verificationRuns)
        .where(eq(verificationRuns.sessionId, sessionId))
        .orderBy(asc(verificationRuns.startedAt))
        .all();
    },

    insert(row: VerificationRunRow) {
      db.insert(verificationRuns).values(row).run();
    },

    /** Records the final result of a running run, and optionally the new session status. */
    complete(
      id: string,
      fields: Partial<VerificationRunRow>,
      session?: { id: string; status: string; updatedAt: string },
    ) {
      db.transaction((tx) => {
        tx.update(verificationRuns)
          .set(fields)
          .where(and(eq(verificationRuns.id, id), eq(verificationRuns.status, "running")))
          .run();
        if (session) {
          tx.update(debugSessions)
            .set({ status: session.status, updatedAt: session.updatedAt })
            .where(eq(debugSessions.id, session.id))
            .run();
        }
      });
    },

    /** Runs still "running" at startup were interrupted by a server restart. */
    failInterrupted(completedAt: string): number {
      return db
        .update(verificationRuns)
        .set({
          status: "error",
          errorMessage: "The server stopped before this run finished; its result is unknown.",
          completedAt,
        })
        .where(eq(verificationRuns.status, "running"))
        .run().changes;
    },
  };
}

export type VerificationsRepository = ReturnType<typeof createVerificationsRepository>;
