/** Invite-only sign-up still lets the very first account in, and only that one. */
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import { canRegisterWithoutInvite } from "@/server/services/inviteService";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
});

afterAll(async () => {
  await pg.close();
});

describe("first account on a fresh deployment", () => {
  it("invite-only: the first account may register; once anyone exists, an invite is required", async () => {
    const env = { REGISTRATION_MODE: "invite_only" };
    expect(await canRegisterWithoutInvite(env)).toBe(true);
    await db.insert(schema.users).values({ email: "owner@x.test", fullName: "Owner" });
    expect(await canRegisterWithoutInvite(env)).toBe(false);
    expect(await canRegisterWithoutInvite({})).toBe(true); // open sign-up
  });
});
