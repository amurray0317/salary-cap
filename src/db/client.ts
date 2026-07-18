/**
 * Database client singleton.
 *
 * - With DATABASE_URL set: connects to managed PostgreSQL (e.g. Supabase).
 * - Without: runs an embedded PGlite (real Postgres) persisted to .data/pglite,
 *   so local development and CI need zero external services.
 *
 * All application code imports `getDb()` and stays driver-agnostic.
 */
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

type DbGlobal = {
  __rosteriqDb?: Db;
  __rosteriqPglite?: PGlite;
};

const g = globalThis as unknown as DbGlobal;

export function getDataDir(): string {
  return process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
}

export function getDb(): Db {
  if (g.__rosteriqDb) return g.__rosteriqDb;

  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    g.__rosteriqDb = drizzlePg(pool, { schema });
  } else {
    const dataDir = getDataDir();
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    const pglite = new PGlite(dataDir);
    g.__rosteriqPglite = pglite;
    g.__rosteriqDb = drizzlePglite(pglite, { schema });
  }
  return g.__rosteriqDb;
}

/** Test helper: swap in an isolated in-memory database. */
export function setDbForTesting(db: Db): void {
  g.__rosteriqDb = db;
}

export { schema };
