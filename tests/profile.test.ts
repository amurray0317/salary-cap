/**
 * Profile, photo, preferences and password rules (PGlite, real migrations).
 */
import path from "path";
import { createHash } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { formatHeight, formatWeight, readPreferences } from "@/lib/preferences";
import {
  ProfileError,
  changePassword,
  readAvatar,
  removeAvatar,
  setAvatar,
  signOutOtherSessions,
  sniffImage,
  updatePreferences,
  updateProfile,
} from "@/server/services/profileService";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const fx = {} as { me: string; teammate: string; stranger: string };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

async function user(email: string, password?: string) {
  const [u] = await db
    .insert(schema.users)
    .values({ email, fullName: email, passwordHash: password ? hashPassword(password) : null })
    .returning();
  return u!.id;
}
const sessionFor = async (userId: string, token: string) =>
  db
    .insert(schema.sessions)
    .values({ userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) });

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
  fx.me = await user("me@t.test", "old-password-1");
  fx.teammate = await user("mate@t.test");
  fx.stranger = await user("stranger@t.test");
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-p" }).returning();
  const [other] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-p" }).returning();
  await db.insert(schema.organizationMembers).values([
    { organizationId: org!.id, userId: fx.me, role: "org_admin" },
    { organizationId: org!.id, userId: fx.teammate, role: "scout" },
    { organizationId: other!.id, userId: fx.stranger, role: "scout" },
  ]);
});

afterAll(async () => {
  await pg.close();
});

describe("profile", () => {
  it("saves name and job title with limits", async () => {
    await updateProfile(fx.me, { fullName: "  Alex Front Office ", jobTitle: "Director of Analytics" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, fx.me));
    expect(u).toMatchObject({ fullName: "Alex Front Office", jobTitle: "Director of Analytics" });
    await updateProfile(fx.me, { fullName: "Alex Front Office", jobTitle: "" });
    expect((await db.select().from(schema.users).where(eq(schema.users.id, fx.me)))[0]!.jobTitle).toBeNull();
    await expect(updateProfile(fx.me, { fullName: " ", jobTitle: "" })).rejects.toThrow(ProfileError);
  });

  it("photo: type from the bytes, size limit, visible to shared-org members only", async () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    await expect(setAvatar(fx.me, Buffer.from("<svg/>"))).rejects.toThrow("PNG, JPEG or WebP");
    await expect(setAvatar(fx.me, Buffer.concat([JPEG, Buffer.alloc(200_001)]))).rejects.toThrow("too large");

    await setAvatar(fx.me, PNG);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, fx.me));
    expect(u!.avatarUpdatedAt).toBeInstanceOf(Date);
    expect((await readAvatar(fx.me, fx.me))?.mime).toBe("image/png");
    expect((await readAvatar(fx.teammate, fx.me))?.bytes.equals(PNG)).toBe(true);
    expect(await readAvatar(fx.stranger, fx.me)).toBeNull();

    await setAvatar(fx.me, JPEG); // replace, not duplicate
    expect((await readAvatar(fx.me, fx.me))?.mime).toBe("image/jpeg");
    await removeAvatar(fx.me);
    expect(await readAvatar(fx.me, fx.me)).toBeNull();
    expect((await db.select().from(schema.users).where(eq(schema.users.id, fx.me)))[0]!.avatarUpdatedAt).toBeNull();
  });

  it("preferences: defaults for missing or bad stored values; updates merge and reject invalid values", async () => {
    expect(readPreferences(null)).toMatchObject({ startPage: "/dashboard", timeZone: "auto", units: "imperial", density: "compact" });
    expect(readPreferences({ units: "furlongs", notifications: { watchlist: false } })).toMatchObject({
      units: "imperial",
      notifications: { watchlist: false, importReady: true, weeklyDigest: false },
    });
    await updatePreferences(fx.me, { timeZone: "America/Chicago", units: "metric" });
    const p = await updatePreferences(fx.me, { notifications: { ...readPreferences({}).notifications, weeklyDigest: true } });
    expect(p).toMatchObject({ timeZone: "America/Chicago", units: "metric", notifications: { weeklyDigest: true } });
    await expect(updatePreferences(fx.me, { startPage: "https://evil.example" as never })).rejects.toThrow("Invalid preference");
    await expect(updatePreferences(fx.me, { timeZone: "Mars/Olympus" as never })).rejects.toThrow("Invalid preference");
  });

  it("units", () => {
    expect(formatHeight(185, "imperial")).toBe("6′1″");
    expect(formatHeight(178, "imperial")).toBe("5′10″");
    expect(formatHeight(185, "metric")).toBe("185 cm");
    expect(formatWeight(88, "imperial")).toBe("194 lb");
    expect(formatWeight(null, "metric")).toBe("—");
  });

  it("password change checks the current one and signs out other sessions only", async () => {
    await sessionFor(fx.me, "this-device");
    await sessionFor(fx.me, "laptop");
    await sessionFor(fx.teammate, "mate-phone");
    await expect(changePassword(fx.me, { current: "wrong", next: "new-password-2", currentToken: "this-device" })).rejects.toThrow("incorrect");
    await expect(changePassword(fx.me, { current: "old-password-1", next: "short", currentToken: "this-device" })).rejects.toThrow("8 to 200");
    expect(await changePassword(fx.me, { current: "old-password-1", next: "new-password-2", currentToken: "this-device" })).toBe(1);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, fx.me));
    expect(verifyPassword("new-password-2", u!.passwordHash!)).toBe(true);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, fx.me))).toHaveLength(1);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, fx.teammate))).toHaveLength(1);
    expect(await signOutOtherSessions(fx.me, "this-device")).toBe(0);
  });
});
