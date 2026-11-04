import { desc, eq } from "drizzle-orm";
import type { Db } from "../database/client";
import { projects, type NewProjectRow, type ProjectRow } from "../database/schema";

export function createProjectsRepository(db: Db) {
  return {
    list(): ProjectRow[] {
      return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
    },
    findById(id: string): ProjectRow | undefined {
      return db.select().from(projects).where(eq(projects.id, id)).get();
    },
    findByDirectory(directory: string): ProjectRow | undefined {
      return db.select().from(projects).where(eq(projects.directory, directory)).get();
    },
    insert(row: NewProjectRow): ProjectRow {
      return db.insert(projects).values(row).returning().get();
    },
  };
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;
