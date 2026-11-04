import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../database/client";
import { debugSessions, patchProposals, type PatchProposalRow } from "../database/schema";

export function createPatchesRepository(db: Db) {
  return {
    find(id: string): PatchProposalRow | undefined {
      return db.select().from(patchProposals).where(eq(patchProposals.id, id)).get();
    },

    listBySession(sessionId: string): PatchProposalRow[] {
      return db
        .select()
        .from(patchProposals)
        .where(eq(patchProposals.sessionId, sessionId))
        .orderBy(asc(patchProposals.createdAt))
        .all();
    },

    /** Inserts a proposal, superseding any still-open proposal in the same session. */
    insertProposal(row: PatchProposalRow, sessionStatus: string) {
      db.transaction((tx) => {
        tx.update(patchProposals)
          .set({ status: "superseded" })
          .where(
            and(eq(patchProposals.sessionId, row.sessionId), eq(patchProposals.status, "proposed")),
          )
          .run();
        tx.insert(patchProposals).values(row).run();
        tx.update(debugSessions)
          .set({ status: sessionStatus, updatedAt: row.createdAt })
          .where(eq(debugSessions.id, row.sessionId))
          .run();
      });
    },

    /**
     * Moves a proposal from `from` to `to` only if it is still in `from`, so a
     * transition can never happen twice. Returns false if the state had changed.
     */
    transition(
      id: string,
      from: string,
      to: string,
      fields: Partial<PatchProposalRow>,
      session?: { id: string; status: string; updatedAt: string },
    ): boolean {
      return db.transaction((tx) => {
        const result = tx
          .update(patchProposals)
          .set({ ...fields, status: to })
          .where(and(eq(patchProposals.id, id), eq(patchProposals.status, from)))
          .run();
        if (result.changes !== 1) return false;
        if (session) {
          tx.update(debugSessions)
            .set({ status: session.status, updatedAt: session.updatedAt })
            .where(eq(debugSessions.id, session.id))
            .run();
        }
        return true;
      });
    },

    /** Records the outcome of an attempt without changing the status. */
    setResult(id: string, applicationResult: string) {
      db.update(patchProposals).set({ applicationResult }).where(eq(patchProposals.id, id)).run();
    },
  };
}

export type PatchesRepository = ReturnType<typeof createPatchesRepository>;
