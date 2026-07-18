"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ORG_COOKIE, SEASON_COOKIE, TEAM_COOKIE } from "@/server/appContext";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/" };

export async function setContextAction(formData: FormData): Promise<void> {
  const store = await cookies();
  const org = formData.get("org");
  const team = formData.get("team");
  const season = formData.get("season");
  const back = formData.get("back");
  if (typeof org === "string" && org) {
    store.set(ORG_COOKIE, org, COOKIE_OPTS);
    // Changing org invalidates team/season selections.
    store.delete(TEAM_COOKIE);
    store.delete(SEASON_COOKIE);
  }
  if (typeof team === "string" && team) store.set(TEAM_COOKIE, team, COOKIE_OPTS);
  if (typeof season === "string" && season) store.set(SEASON_COOKIE, season, COOKIE_OPTS);
  redirect(typeof back === "string" && back.startsWith("/") ? back : "/dashboard");
}
