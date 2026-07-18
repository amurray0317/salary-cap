import Link from "next/link";
import type { Metadata } from "next";
import { loginAction } from "@/server/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="inline-block h-6 w-6 rounded bg-accent" aria-hidden />
        <span className="text-lg font-semibold">RosterIQ</span>
      </Link>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">
        Demo: gm@aurora.demo / rosteriq-demo
      </p>
      <AuthForm
        action={loginAction}
        submitLabel="Sign in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      <p className="mt-6 text-sm text-ink-muted">
        No account?{" "}
        <Link href="/register" className="text-accent-text hover:underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
