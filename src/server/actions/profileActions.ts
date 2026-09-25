"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { NOTIFICATION_TOPICS, type Preferences } from "@/lib/preferences";
import {
  ProfileError,
  changePassword,
  removeAvatar,
  setAvatar,
  signOutOtherSessions,
  updatePreferences,
  updateProfile,
} from "@/server/services/profileService";

async function me() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Runs a profile change, then returns to `page` with ?saved= (fixed text, or the text `fn` returns) or ?error=. */
async function run(page: string, saved: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    const out = await fn();
    if (typeof out === "string") saved = out;
  } catch (err) {
    if (err instanceof ProfileError) redirect(`${page}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  revalidatePath("/", "layout");
  redirect(`${page}?saved=${encodeURIComponent(saved)}`);
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await me();
  await run("/profile", "Profile saved", () =>
    updateProfile(user.id, { fullName: String(formData.get("fullName") ?? ""), jobTitle: String(formData.get("jobTitle") ?? "") }),
  );
}

/** Called from the photo picker after the browser has resized the image. */
export async function uploadAvatarAction(formData: FormData): Promise<{ error?: string }> {
  const user = await me();
  const file = formData.get("avatar");
  if (!(file instanceof Blob)) return { error: "Choose an image" };
  try {
    await setAvatar(user.id, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ProfileError) return { error: err.message };
    throw err;
  }
  revalidatePath("/", "layout");
  return {};
}

export async function removeAvatarAction(): Promise<void> {
  const user = await me();
  await run("/profile", "Photo removed", () => removeAvatar(user.id));
}

export async function savePreferencesAction(formData: FormData): Promise<void> {
  const user = await me();
  const patch = {
    startPage: String(formData.get("startPage")),
    timeZone: String(formData.get("timeZone")),
    units: String(formData.get("units")),
    density: String(formData.get("density")),
  } as Partial<Preferences>;
  await run("/profile/preferences", "Preferences saved", () => updatePreferences(user.id, patch));
}

export async function saveNotificationsAction(formData: FormData): Promise<void> {
  const user = await me();
  const notifications = Object.fromEntries(NOTIFICATION_TOPICS.map((t) => [t.key, formData.get(t.key) === "on"])) as Preferences["notifications"];
  await run("/profile/notifications", "Notification choices saved", () => updatePreferences(user.id, { notifications }));
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await me();
  const next = String(formData.get("next") ?? "");
  if (next !== String(formData.get("confirm") ?? "")) redirect("/profile/account?error=" + encodeURIComponent("The new passwords do not match"));
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  await run("/profile/account", "Password changed; other devices were signed out", () =>
    changePassword(user.id, { current: String(formData.get("current") ?? ""), next, currentToken: token }),
  );
}

export async function signOutOthersAction(): Promise<void> {
  const user = await me();
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  await run("/profile/account", "", async () => {
    const n = await signOutOtherSessions(user.id, token);
    return `Signed out of ${n} other session${n === 1 ? "" : "s"}`;
  });
}
