import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export interface DatabaseHandle {
  db: Db;
  ping(): boolean;
  close(): void;
}

/** Opens the SQLite database and applies any pending migrations. */
export function openDatabase(databasePath: string): DatabaseHandle {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  return {
    db,
    ping() {
      try {
        sqlite.prepare("select 1").get();
        return true;
      } catch {
        return false;
      }
    },
    close() {
      sqlite.close();
    },
  };
}
