import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { removeAvatarAction, updateProfileAction } from "@/server/actions/profileActions";
import { Avatar, avatarUrl } from "@/components/Avatar";
import { AvatarPicker } from "@/components/AvatarPicker";
import { Notice } from "@/components/Notice";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Profile" };

const input = "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const src = avatarUrl(ctx.user);
  return (
    <div className="space-y-5">
      <Notice saved={sp.saved} error={sp.error} />
      <Card title="Photo">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={ctx.user.fullName} src={src} size={96} className="shadow-md" />
          <div className="space-y-2">
            <AvatarPicker hasPhoto={!!src} />
            {src && (
              <form action={removeAvatarAction}>
                <button className="text-sm text-ink-muted hover:text-critical">Remove photo</button>
              </form>
            )}
            <p className="text-xs text-ink-muted">
              Cropped to a square and resized to 256 px before upload. Seen only by people in your organizations.
            </p>
          </div>
        </div>
      </Card>
      <Card title="About you">
        <form action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink-secondary">
            Full name
            <input name="fullName" required maxLength={120} defaultValue={ctx.user.fullName} className={input} autoComplete="name" />
          </label>
          <label className="text-sm font-medium text-ink-secondary">
            Job title
            <input
              name="jobTitle"
              maxLength={80}
              defaultValue={ctx.user.jobTitle ?? ""}
              placeholder="e.g. Amateur Scout, Western Canada"
              className={input}
            />
          </label>
          <label className="text-sm font-medium text-ink-secondary sm:col-span-2">
            Email
            <input value={ctx.user.email} readOnly disabled className={`${input} bg-subtle text-ink-muted`} />
            <span className="mt-1 block text-xs font-normal text-ink-muted">
              Email changes need address verification, which arrives with hosted sign-in.
            </span>
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Save profile</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
