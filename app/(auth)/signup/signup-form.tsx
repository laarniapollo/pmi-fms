"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { checkPassword } from "@/lib/auth/password";
import { signUp, type AuthState } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});
  const [password, setPassword] = useState("");

  // Same function the server action runs, so the meter and the verdict agree.
  const strength = checkPassword(password);

  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-danger/25 bg-danger-soft px-3 py-2"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
          <p className="text-xs text-danger">{state.error}</p>
        </div>
      ) : null}

      <FormField label="Full name" error={state.fieldErrors?.name} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="name"
            autoComplete="name"
            placeholder="Alex Moreau"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.name)}
            autoFocus
          />
        )}
      </FormField>

      <FormField label="Work email" error={state.fieldErrors?.email} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.email)}
          />
        )}
      </FormField>

      <FormField label="Password" error={state.fieldErrors?.password} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.password)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </FormField>

      {password ? <StrengthMeter score={strength.score} problems={strength.problems} /> : null}

      <FormField label="Confirm password" error={state.fieldErrors?.confirm} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="confirm"
            type="password"
            autoComplete="new-password"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.confirm)}
          />
        )}
      </FormField>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="w-full justify-center"
      >
        {pending ? "Creating account" : "Create account"}
      </Button>
    </form>
  );
}

function StrengthMeter({ score, problems }: { score: number; problems: string[] }) {
  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"] as const;

  return (
    <div aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={cn(
                "h-0.5 flex-1 rounded-full transition-colors",
                index < score ? (score >= 3 ? "bg-accent" : "bg-warn") : "bg-line",
              )}
            />
          ))}
        </div>
        <span className={cn("text-2xs", score >= 3 ? "text-accent" : "text-ink-muted")}>
          {labels[score]}
        </span>
      </div>

      {problems.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {problems.map((problem) => (
            <li key={problem} className="text-2xs text-ink-muted">
              {problem}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 flex items-center gap-1 text-2xs text-accent">
          <Check className="h-3 w-3" aria-hidden="true" />
          Meets all requirements
        </p>
      )}
    </div>
  );
}
