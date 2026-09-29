import Link from "next/link";
import { Check } from "lucide-react";

import { Wordmark } from "@/components/brand";

/**
 * Split threshold screen: the form on white, and beside it the product's own
 * subject matter — one invoice walking its approval chain. Ink is the only
 * heavy surface in the whole application, and it lives here, before the
 * operational canvas begins.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,46%)]">
      <div className="flex flex-col bg-surface px-6 py-8 sm:px-12 lg:px-16">
        <Link href="/" className="inline-flex w-fit rounded">
          <Wordmark size="md" />
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <p className="text-2xs text-ink-subtle">
          Apollo Financial Group · Financial management
        </p>
      </div>

      <AuthAside />
    </div>
  );
}

const TRAIL = [
  { label: "Entered", who: "Josefina Dimaculangan", meta: "Scanned · 96% confidence", done: true },
  { label: "Submitted", who: "Routed on ₱1,394,400.00", meta: "One approval required", done: true },
  { label: "Approved", who: "Ramon Villanueva", meta: "Matched to PO-48221", done: true },
  { label: "Paid", who: "PESONet · BDO ending 4417", meta: "Credited the next banking day", done: true },
];

function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-center lg:px-14">
      {/* Ledger rules, barely there — structure rather than decoration. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage: "repeating-linear-gradient(180deg, #fff 0 1px, transparent 1px 34px)",
        }}
      />

      <div className="relative max-w-md">
        <p className="col-head text-white/40">Invoice BCS-2026-0184</p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-white">
          Every invoice carries its own paper trail.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          Capture it, route it by amount, and pay it — with each decision, and the person who made
          it, recorded as it happens.
        </p>

        <ol className="mt-8 space-y-0">
          {TRAIL.map((step, index) => (
            // A fixed, ordered list where position is identity, and labels
            // are not guaranteed unique as steps are added — so the index is
            // the honest key here.
            <li key={`${step.label}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent">
                  <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden="true" />
                </span>
                {index < TRAIL.length - 1 ? (
                  <span aria-hidden="true" className="my-1 w-px flex-1 bg-accent/35" />
                ) : null}
              </div>
              <div className={index < TRAIL.length - 1 ? "pb-5" : ""}>
                <p className="text-sm font-medium leading-5 text-white">{step.label}</p>
                <p className="text-xs leading-5 text-white/60">{step.who}</p>
                <p className="text-2xs leading-4 text-white/35">{step.meta}</p>
              </div>
            </li>
          ))}
        </ol>

        <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
          <Stat value="4" label="Roles, separated" />
          <Stat value="2 days" label="Median to approval" />
          <Stat value="100%" label="Actions audited" />
        </dl>
      </div>
    </aside>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-lg font-semibold tabular-nums text-white">{value}</dt>
      <dd className="mt-0.5 text-2xs leading-4 text-white/45">{label}</dd>
    </div>
  );
}
