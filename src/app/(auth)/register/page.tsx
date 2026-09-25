import Link from "next/link";
import type { Metadata } from "next";
import { registerAction } from "@/server/actions/auth";
import { AuthForm } from "@/components/AuthForm";
import { registrationMode } from "@/server/services/inviteService";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const inviteOnly = registrationMode() === "invite_only";
  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="mb-8 flex items-center gap-2 lg:hidden">
        <span className="inline-block h-6 w-6 rounded bg-linear-to-br from-ice-bright to-accent" aria-hidden />
        <span className="font-display text-lg font-extrabold">RosterIQ</span>
      </Link>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">
        {invite
          ? "You'll join the organization that invited you."
          : inviteOnly
            ? "New accounts need an invite link from an organization admin."
            : "You'll create or join an organization next."}
      </p>
      <AuthForm
        hidden={invite ? { invite } : {}}
        action={registerAction}
        submitLabel="Create account"
        fields={[
          { name: "fullName", label: "Full name", type: "text", autoComplete: "name" },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password (8+ characters)", type: "password", autoComplete: "new-password" },
        ]}
      />
      <p className="mt-6 text-sm text-ink-muted">
        Already registered?{" "}
        <Link href="/login" className="text-accent-text hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
