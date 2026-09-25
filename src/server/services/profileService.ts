/**
 * The signed-in user's own profile: name, job title, photo, preferences and
 * password. Every function acts on the given user id only; callers pass the
 * session user's id, never one taken from a form.
 */
import { createHash } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { preferencesSchema, readPreferences, type Preferences } from "@/lib/preferences";

export class ProfileError extends Error {}

/** Decoded size limit for a profile photo. The browser resizes to 256 px first, which lands far below this. */
export const AVATAR_MAX_BYTES = 200_000;

export async function updateProfile(userId: string, input: { fullName: string; jobTitle: string }) {
  const fullName = input.fullName.trim();
  const jobTitle = input.jobTitle.trim();
  if (!fullName || fullName.length > 120) throw new ProfileError("Name must be 1 to 120 characters");
  if (jobTitle.length > 80) throw new ProfileError("Job title must be at most 80 characters");
  await getDb()
    .update(schema.users)
    .set({ fullName, jobTitle: jobTitle || null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/** Merges a partial update into the stored preferences; invalid values are rejected, not silently defaulted. */
export async function updatePreferences(userId: string, patch: Partial<Preferences>): Promise<Preferences> {
  const db = getDb();
  const [row] = await db.select({ preferences: schema.users.preferences }).from(schema.users).where(eq(schema.users.id, userId));
  if (!row) throw new ProfileError("User not found");
  const current = readPreferences(row.preferences);
  const merged = { ...current, ...patch, notifications: { ...current.notifications, ...patch.notifications } };
  const strict = preferencesSchema.safeParse(merged);
  const checked = strict.success ? strict.data : null;
  // .catch() in the schema turns bad values into defaults; compare to catch them here instead.
  if (!checked || JSON.stringify(checked) !== JSON.stringify(merged)) throw new ProfileError("Invalid preference value");
  await db.update(schema.users).set({ preferences: checked, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return checked;
}

/** The image type from its first bytes; the declared type is never trusted. */
export function sniffImage(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return "image/webp";
  return null;
}

export async function setAvatar(userId: string, bytes: Buffer) {
  if (bytes.length === 0) throw new ProfileError("Choose an image");
  if (bytes.length > AVATAR_MAX_BYTES) throw new ProfileError("Image is too large (200 KB maximum after resizing)");
  const mime = sniffImage(bytes);
  if (!mime) throw new ProfileError("Use a PNG, JPEG or WebP image");
  const now = new Date();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.userAvatars)
      .values({ userId, mime, data: bytes.toString("base64"), updatedAt: now })
      .onConflictDoUpdate({ target: schema.userAvatars.userId, set: { mime, data: bytes.toString("base64"), updatedAt: now } });
    await tx.update(schema.users).set({ avatarUpdatedAt: now }).where(eq(schema.users.id, userId));
  });
}

export async function removeAvatar(userId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
    await tx.update(schema.users).set({ avatarUpdatedAt: null }).where(eq(schema.users.id, userId));
  });
}

/**
 * The photo of `userId` as seen by `viewerId`: allowed for yourself and for
 * people who share an organization with you; otherwise null (not found).
 */
export async function readAvatar(viewerId: string, userId: string): Promise<{ mime: string; bytes: Buffer; updatedAt: Date } | null> {
  const db = getDb();
  if (viewerId !== userId) {
    const mine = schema.organizationMembers;
    const theirs = alias(schema.organizationMembers, "theirs");
    const shared = await db
      .select({ org: mine.organizationId })
      .from(mine)
      .innerJoin(theirs, eq(theirs.organizationId, mine.organizationId))
      .where(and(eq(mine.userId, viewerId), eq(theirs.userId, userId)))
      .limit(1);
    if (shared.length === 0) return null;
  }
  const [row] = await db.select().from(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
  return row ? { mime: row.mime, bytes: Buffer.from(row.data, "base64"), updatedAt: row.updatedAt } : null;
}

/** Changes the password and signs out every other session (the current one, identified by its token, stays). */
export async function changePassword(userId: string, input: { current: string; next: string; currentToken: string | null }) {
  const db = getDb();
  const [user] = await db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.passwordHash) throw new ProfileError("This account signs in through another provider");
  if (!verifyPassword(input.current, user.passwordHash)) throw new ProfileError("Current password is incorrect");
  if (input.next.length < 8 || input.next.length > 200) throw new ProfileError("New password must be 8 to 200 characters");
  if (input.next === input.current) throw new ProfileError("Choose a different password");
  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(input.next), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  return signOutOtherSessions(userId, input.currentToken);
}

/** Ends every session of this user except the current one; returns how many were ended. */
export async function signOutOtherSessions(userId: string, currentToken: string | null): Promise<number> {
  const db = getDb();
  // Same hash as src/lib/auth/session.ts (SHA-256 hex of the cookie token).
  const keep = currentToken ? createHash("sha256").update(currentToken).digest("hex") : "";
  const ended = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.tokenHash, keep)))
    .returning();
  return ended.length;
}
