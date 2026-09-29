import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";
import { DemoAccounts } from "../demo-accounts";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");

  const { next } = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Enter your details to reach your approval queue.
      </p>

      <LoginForm next={next} />

      <p className="mt-6 text-sm text-ink-muted">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>

      <DemoAccounts />
    </div>
  );
}
