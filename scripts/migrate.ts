/**
 * Applies SQL migrations from ./drizzle to the configured database
 * (managed Postgres when DATABASE_URL is set, embedded PGlite otherwise).
 */
import path from "path";
import fs from "fs";

async function main() {
  const migrationsFolder = path.join(process.cwd(), "drizzle");

  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    await pool.end();
  } else {
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { PGlite } = await import("@electric-sql/pglite");
    const dataDir =
      process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    const pglite = new PGlite(dataDir);
    const db = drizzle(pglite);
    await migrate(db, { migrationsFolder });
    await pglite.close();
  }
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
