import Link from "next/link";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { lookupInvite } from "@/server/services/inviteService";
import { acceptInviteAction } from "@/server/actions/inviteActions";

export const metadata: Metadata = { title: "Join an organization" };
export const dynamic = "force-dynamic";

const STATUS_TEXT = {
  expired: "This invite has expired. Ask the person who sent it for a new link.",
  revoked: "This invite was cancelled. Ask the person who sent it for a new link.",
  used: "This invite has already been used.",
  not_found: "This invite link is not valid. Check that you copied the whole link.",
} as const;

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const info = await lookupInvite(token);
  const user = await getSessionUser();
  const role = info.status === "valid" && info.role ? info.role.replace(/_/g, " ") : "";

  return (
    <div className="w-full max-w-sm">
      <h1>{info.status === "valid" ? `Join ${info.orgName}` : "Invite unavailable"}</h1>
      {info.status === "valid" ? (
        <>
          <p className="mb-6 mt-2 text-sm text-ink-secondary">
            You&rsquo;ve been invited to <span className="font-semibold text-ink">{info.orgName}</span> as{" "}
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-semibold capitalize text-accent-text">{role}</span>.
            {info.email && <> This invite is for {info.email}.</>}
          </p>
          {error && (
            <p role="alert" className="mb-4 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </p>
          )}
          {user ? (
            <form action={acceptInviteAction}>
              <input type="hidden" name="token" value={token} />
              <button className="w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90">Join as {user.email}</button>
            </form>
          ) : (
            <div className="space-y-3">
              <Link
                href={`/register?invite=${encodeURIComponent(token)}`}
                className="block w-full rounded-md bg-accent px-4 py-2 text-center font-medium text-white hover:opacity-90"
              >
                Create an account and join
              </Link>
              <Link
                href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="block w-full rounded-md border border-line px-4 py-2 text-center font-medium text-ink-secondary hover:text-ink"
              >
                I already have an account
              </Link>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-secondary">{STATUS_TEXT[info.status]}</p>
      )}
    </div>
  );
}
