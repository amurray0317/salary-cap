"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrgAccess } from "@/server/context";
import { TEAM_COOKIE } from "@/server/appContext";
import { NhlClubError, importNhlClub } from "@/server/services/nhlClubService";
import { NHL_TEAMS } from "@/lib/connectors/nhl";

/** Admins only: set the organization up as a real NHL club from the NHL's public roster. */
export async function importNhlClubAction(fd: FormData): Promise<void> {
  const parsed = z
    .object({ organizationId: z.string().uuid(), team: z.enum(NHL_TEAMS), hideOthers: z.boolean() })
    .safeParse({ organizationId: fd.get("organizationId"), team: fd.get("team"), hideOthers: fd.get("hideOthers") === "on" });
  if (!parsed.success) redirect(`/settings?error=${encodeURIComponent("Choose an NHL club")}`);
  const { organizationId, team, hideOthers } = parsed.data!;
  const ctx = await requireOrgAccess(organizationId, "admin");
  let msg: string;
  try {
    const r = await importNhlClub({ organizationId, actorId: ctx.user.id, team, hideOtherTeams: hideOthers });
    (await cookies()).set(TEAM_COOKIE, r.teamId, { httpOnly: true, sameSite: "lax", path: "/" });
    msg = `${r.teamName}: ${r.onRoster} players from the NHL's ${r.season} roster (${r.added} added, ${r.updated} refreshed). Contracts are not in public NHL data; add them in Cap & contracts.`;
  } catch (err) {
    if (err instanceof NhlClubError) redirect(`/settings?error=${encodeURIComponent(err.message)}`);
    redirect(`/settings?error=${encodeURIComponent("Could not reach the NHL API; try again shortly")}`);
  }
  revalidatePath("/", "layout");
  redirect(`/settings?saved=${encodeURIComponent(msg)}`);
}
