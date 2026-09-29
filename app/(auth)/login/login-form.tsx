"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { signIn, type AuthState } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-danger/25 bg-danger-soft px-3 py-2"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
          <p className="text-xs text-danger">{state.error}</p>
        </div>
      ) : null}

      <FormField label="Email" error={state.fieldErrors?.email} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.email)}
            autoFocus
          />
        )}
      </FormField>

      <FormField label="Password" error={state.fieldErrors?.password} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.password)}
          />
        )}
      </FormField>

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full justify-center">
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
