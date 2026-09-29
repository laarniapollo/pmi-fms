"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { ROLE_META, type Role } from "@/lib/constants";

/**
 * Seeded sign-ins, so the four roles can be compared without creating
 * accounts. Present only because this database ships with demo data — it has
 * no place in an environment with real suppliers in it.
 */
const ACCOUNTS: Array<{ email: string; name: string; role: Role }> = [
  { email: "admin@apollo-ap.com", name: "Priya Raghunathan", role: "ADMIN" },
  { email: "approver@apollo-ap.com", name: "Daniel Okafor", role: "APPROVER" },
  { email: "clerk@apollo-ap.com", name: "Mei-Lin Cheung", role: "CLERK" },
  { email: "auditor@apollo-ap.com", name: "Tomas Lindqvist", role: "AUDITOR" },
];

const PASSWORD = "Apollo!2026";

export function DemoAccounts() {
  const [open, setOpen] = useState(false);

  const fill = (email: string) => {
    const form = document.querySelector<HTMLFormElement>("form");
    if (!form) return;

    const emailField = form.elements.namedItem("email") as HTMLInputElement | null;
    const passwordField = form.elements.namedItem("password") as HTMLInputElement | null;

    // Assigning `.value` directly skips React's synthetic onChange, but these
    // inputs are uncontrolled and the form reads the DOM on submit, so the
    // value that lands here is the value that gets posted.
    if (emailField) emailField.value = email;
    if (passwordField) passwordField.value = PASSWORD;
    passwordField?.focus();
  };

  return (
    <div className="mt-8 rounded-lg border border-line bg-surface-sunken">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span>
          <span className="text-xs font-medium text-ink">Demo accounts</span>
          <span className="ml-1.5 text-2xs text-ink-subtle">Seeded data · one per role</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="border-t border-line p-1.5">
          {ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => fill(account.email)}
              className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-surface"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-ink">{account.name}</span>
                <span className="ident block truncate text-ink-subtle">{account.email}</span>
              </span>
              <span className="shrink-0 text-2xs text-ink-muted">
                {ROLE_META[account.role].label}
              </span>
            </button>
          ))}
          <p className="px-2 pb-1 pt-2 text-2xs text-ink-subtle">
            Password for all four: <span className="ident text-ink-muted">{PASSWORD}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
