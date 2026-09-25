import { resolveAppContext } from "@/server/appContext";
import { Avatar, avatarUrl } from "@/components/Avatar";
import { ProfileTabs } from "@/components/ProfileTabs";
import { roleLabel } from "@/lib/auth/roles";

export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const ctx = await resolveAppContext();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={ctx.user.fullName} src={avatarUrl(ctx.user)} size={64} className="shadow-md" />
        <div className="min-w-0">
          <h1 className="truncate">{ctx.user.fullName}</h1>
          <p className="text-sm text-ink-muted">{[ctx.user.jobTitle, `${roleLabel(ctx.role)} · ${ctx.org.name}`].filter(Boolean).join(" — ")}</p>
        </div>
      </div>
      <ProfileTabs />
      {children}
    </div>
  );
}
