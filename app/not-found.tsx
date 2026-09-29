import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-16 text-center">
      <Wordmark size="md" />

      <p className="ident mt-10 text-ink-subtle">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        That page isn&rsquo;t here
      </h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        The link may be out of date, or the invoice it pointed at may have been archived or voided.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <ButtonLink href="/dashboard" variant="primary" size="md">
          Back to dashboard
        </ButtonLink>
        <ButtonLink href="/invoices" variant="secondary" size="md">
          Browse invoices
        </ButtonLink>
      </div>

      <p className="mt-8 text-2xs text-ink-subtle">
        Looking for something archived?{" "}
        <Link href="/archive" className="text-accent hover:underline">
          Check the archive
        </Link>
      </p>
    </div>
  );
}
