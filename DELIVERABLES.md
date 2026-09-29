# Apollo AP — Deliverables Tracker

Accounts payable management for Apollo Financial Group. This is the single
source of truth for what is built, what is verified, and what is outstanding.

**Last updated:** 13 August 2026 · **Current state:** Phases 1 and 2 complete and verified, localised to the Philippines · **Awaiting:** approval to start Phase 3

| | Phase 1 — Foundation | Phase 2 — Workflow engine | Phase 3 — Surrounding surface |
|---|---|---|---|
| Status | **Complete** | **Complete** | Not started |
| Deliverables | 7 of 7 | 7 of 7 | 0 of 8 |
| Routes live | 9 | 20 | — |

**Legend** — `Done` shipped and verified · `Partial` usable but incomplete · `Planned` scheduled, not started · `Blocked` needs a decision from you

---

## Running it

The app is served on this host (`apollo`), not on your workstation — the repo is
SSH-mounted, so `localhost` in your browser is the wrong machine.

| Purpose | Address |
|---|---|
| Production build | `http://192.168.88.89:3010` |
| Dev server (hot reload) | `http://192.168.88.89:3002` |
| If the LAN address is not routable | `ssh -N -L 3010:localhost:3010 apollo@192.168.88.89` then use `http://localhost:3010` |

### Demo sign-ins

Password for all four: `Apollo!2026`. The login screen has a one-click filler.
These are seeded local credentials and must never reach a real environment.

| Email | Person | Role | What they can do |
|---|---|---|---|
| `admin@apollo-ap.com` | Imelda Bautista | Administrator | Everything, including users, approval rules, billing |
| `approver@apollo-ap.com` | Ramon Villanueva | Approver | Approve or reject invoices, release payments |
| `clerk@apollo-ap.com` | Josefina Dimaculangan | AP Clerk | Enter and scan invoices, submit for approval |
| `auditor@apollo-ap.com` | Teresita Manalo | Auditor | Read everything, read the audit trail, export |

### Commands

```bash
npm run dev           # development server
npm run build         # production build (runs prisma generate first)
npm run start         # serve the production build
npm test              # 125 unit tests
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run verify:data   # 16 ledger invariants + tier and VAT coverage
npm run db:seed       # regenerate six months of seeded history
npm run start -- -p 3010   # the port the checks below assume

# End-to-end checks, against a running server
node scripts/check-workflow.mjs http://localhost:3010   # the whole AP path, two roles
node scripts/check-scan.mjs     http://localhost:3010   # real scan of a real document
node scripts/check-realtime.mjs http://localhost:3010   # live updates across two sessions
node scripts/shoot.mjs          http://localhost:3010 ./shots 1440   # every screen + console errors
node scripts/make-test-invoice.mjs                      # regenerate the scan fixture
```

> **Stop the dev server before running `npm run build`.** `next dev` and
> `next start` share the `.next` directory, and a dev server writing to it
> while a production build is served yields 500s on every route.

---

## Phase 1 — Foundation and core AP · **Complete**

| # | Deliverable | Status | Where it lives |
|---|---|---|---|
| 1 | Project scaffold — Next.js 15, TypeScript strict, Tailwind v4, Prisma/SQLite | Done | `next.config.ts`, `tsconfig.json`, `prisma/schema.prisma` |
| 2 | Design tokens and 15 UI primitives | Done | `app/globals.css`, `components/ui/` |
| 3 | Data model, migration, and seeded history | Done | `prisma/schema.prisma`, `prisma/seed.ts` |
| 4 | Authentication and the RBAC matrix | Done | `lib/auth/` |
| 5 | App shell — collapsible sidebar, sticky header | Done | `components/shell/app-shell.tsx` |
| 6 | Dashboard — KPIs, ageing, monthly spend, queues | Done | `app/(app)/dashboard/`, `components/charts/` |
| 7 | Invoices — list, detail, create, edit | Done | `app/(app)/invoices/` |

### Live routes

```
/                       redirects by session state
/login  /signup         split threshold screen with the approval trail
/dashboard              4 KPI tiles · ageing · settled-by-month · approval queue · activity
/invoices               sortable, filterable, paginated; CSV export of the filtered set
/invoices/new           create with dynamic line items and live totals
/invoices/[id]          approval rail, line items, attachments, payment, full history
/invoices/[id]/edit     edit, locked once approved
/api/export/invoices    CSV of the filtered set
404                     custom not-found screen
```

### Beyond the plan

Two Phase 2 items were pulled forward because leaving them out would have left a
dead button or an incoherent flow:

- **CSV export** (planned for Phase 2 #13) — the invoice list needed a working
  Export button, not a link to nothing.
- **Submit for approval** (planned for Phase 2 #8) — creating an invoice you
  cannot submit is half a feature. Approval *routing* works; approve/reject is
  still Phase 2.

---

## Phase 2 — Workflow engine · **Complete**

| # | Deliverable | Status | Where it lives |
|---|---|---|---|
| 8 | Approvals queue — approve/reject with comments, sequential chain | Done | `app/(app)/approvals/` |
| 9 | File upload — authenticated storage, drag-drop, previews | Done | `lib/storage.ts`, `app/api/upload/`, `app/api/files/[name]/` |
| 10 | Document scanning — real extraction, flagged fields, fills the form in place | Done | `lib/extract/`, `app/api/scan/`, `components/invoices/` |
| 11 | Payments — scheduling, batch runs, execution | Done | `app/(app)/payments/` |
| 12 | Audit log viewer, plus vendors and archive screens | Done | `app/(app)/audit/`, `/vendors/`, `/archive/` |
| 13 | PDF export | Done | `lib/export/invoice-pdf.ts` |
| 14 | Real-time updates via SSE | Done | `lib/realtime/bus.ts`, `app/api/events/`, `components/realtime/` |

### What each one actually does

- **Approvals** — every invoice needs a signature, from ₱0 up; nothing clears
  itself. Rejecting demands a reason and sends it back to be corrected, which is
  a different thing from voiding it. The engine still routes multi-step chains
  and still refuses anyone a second signature on the same invoice — the shipped
  ladder simply does not ask for two, so that behaviour is proven in
  `lib/approvals/decide-step.test.ts` rather than through the buttons.
- **Upload** — files are written outside `public/` and streamed back through a
  route that checks the session and resolves the name through the database
  first, so path traversal never reaches the filesystem.
- **Scanning** — the uploaded document is sent from our server to Google's
  Gemini API, which reads it and returns structured JSON; the reply is
  validated, its arithmetic cross-checked, and used to fill the invoice form on
  the same page. **A supplier's invoice therefore leaves this machine.** The API
  key is server-side only (`lib/extract/gemini-client.ts` carries
  `import "server-only"`), so the browser makes no external request and never
  sees the key. Anything not printed on the document is left blank rather than
  guessed. Verified: an invoice image reads correctly on every field in ~4.5
  seconds.
- **Payments** — the invoice is marked paid inside the same transaction that
  completes the payment, so the two can never disagree.
- **Audit** — filterable by person, action, record type, and date range, with
  field-level diffs. Exporting the log is itself an audited event.
- **Real-time** — one SSE stream per session. Your own actions never toast back
  at you, and refreshes are coalesced so a 40-invoice payment run does not fire
  40 re-renders.

**Unblocked:** `/approvals`, `/payments`, `/vendors`, `/archive`, `/audit`

---

## Phase 3 — Surrounding surface · **Not started**

| # | Deliverable | Status |
|---|---|---|
| 15 | Settings — organisation, users and roles, approval rules, billing | Planned |
| 16 | Profile — details, password, sessions, notification preferences | Planned |
| 17 | Notifications — header dropdown and full page | Planned |
| 18 | Search results — cross-entity | Planned |
| 19 | Archive — archived and voided invoices, restore | Planned |
| 20 | Pricing — three tiers, current plan, upgrade flow | Planned |
| 21 | Onboarding — first-run wizard and spotlight tour | Planned |
| 22 | Polish — error page, empty-state audit, responsive and a11y pass | Planned |

**Unblocks these dead links:** `/settings`, `/profile`, `/notifications`, `/search`

(`/archive` and `/vendors` shipped in Phase 2 — #19 revisits archive to add
restore, not to build the screen.)

---

## Requirements traceability

### Features from the brief

| Feature | Status | Detail |
|---|---|---|
| Role-based access | **Done** | 4 roles, one `can()` function, layered enforcement, 20 tests |
| Authentication | **Done** | bcrypt, opaque DB session cookies, only the hash stored |
| Search & filtering | **Partial** | Invoice, vendor, payment, and audit filters live; global cross-entity search is Phase 3 |
| Sorting & pagination | **Done** | Server-side, URL-driven, shareable |
| Export to CSV/PDF | **Done** | Invoice CSV, audit CSV, and invoice PDF — all audited |
| Audit log | **Done** | Writer on every mutation, plus a filterable viewer with diffs |
| File upload | **Done** | Authenticated storage outside `public/` |
| Document scanning | **Done** | Gemini-backed extraction; the document is sent to Google, the key never leaves the server |
| Real-time updates | **Done** | SSE, verified across two separate sessions |
| Payments & billing | **Partial** | Vendor payments done on PH rails (PESONet, InstaPay, RTGS, cheque); SaaS subscription billing is Phase 3 |
| Onboarding tour | **Planned** | Phase 3 |

### Screens from the brief

| Screen | Status | | Screen | Status |
|---|---|---|---|---|
| Login | **Done** | | Search results | Planned |
| Sign up | **Done** | | Onboarding | Planned |
| Dashboard | **Done** | | Pricing | Planned |
| Listing / index | **Done** | | Notifications | Planned |
| Detail view | **Done** | | Settings | Planned |
| Create / edit | **Done** | | Profile | Planned |
| Invoice | **Done** | | Archive | **Done** — restore is Phase 3 #19 |
| 404 | **Done** | | Error page | Planned |
| Empty state | **Partial** — component built and used on lists; full audit is Phase 3 | | | |

---

## Verification evidence

Everything below was run against the production build, not the dev server.

| Check | Result |
|---|---|
| Unit tests | 162 passed — 76 extraction and reconciliation, 23 formatting, 23 permissions, 15 approval routing, 10 vendor input, 8 chain decisions, 7 form-diff. All run offline with no API key |
| Typecheck | Clean, `strict` with `noUncheckedIndexedAccess` |
| Lint | Clean |
| Production build | Compiled, 21 routes |
| Ledger invariants | 16 of 16 pass, plus tier and VAT coverage |
| **Workflow, end to end** | **40 of 40** — see below |
| **Scanning, end to end** | Every field correct, vendor matched, **zero** external requests *from the browser* — only the server calls Google |
| **Live updates** | Verified across two separate browser sessions |
| Browser sweep | 22 screens, **zero** hydration errors. See the console-error note below |
| Access control | No cookie → 307; forged cookie → route itself returns 401 |

**On the browser sweep.** Nineteen of the twenty-two screens report two console
errors each, and they are the same two on every one: Next prefetches the
`/settings` and `/notifications` links in the sidebar, both of which 404. It is
the known gap in item 1 below, surfacing as a console error rather than a new
defect — the three screens outside the signed-in shell (login, signup, 404) are
clean. Nothing else errors, and no screen overflows its money columns at peso
magnitudes, which is what the sweep was re-run to check.

### The workflow check (`node scripts/check-workflow.mjs`)

Two people, two browsers, three invoices — this is the check that matters,
because unit tests assert the rules while this asserts the rules are wired to
the buttons. Three invoices, because the approval policy has three things worth
proving: the ordinary path, the ₱3,000,000 escalation, and the floor.

```
 1. Clerk enters an invoice        total computed server-side, saved as draft
 2. Attachment control             submitting without a document is refused
 3. Submitted                      routed to one approval; no owner warning
                                   below the line
 4. Separation of duties           no Approve button on own invoice;
                                   /approvals redirects the clerk away
 5. Approver signs off             fully approved on one signature
 6. Decided work leaves the queue  it is gone from the queue it was signed in
 7. Payment                        scheduled, sent, reference assigned,
                                   invoice marked paid
 8. Audit trail                    all four steps recorded; auditor has no
                                   write actions anywhere
 9. Export                         CSV contains the invoice at 1394400.00
10. Owner authorisation ₱3.92M     still one approval — the owner signs outside
                                   the system; the queue flags it before the
                                   click; approving opens a confirmation; and
                                   the audit trail records no owner decision
11. The floor ₱480.00              still waits for a person; there is no
                                   auto-approve band to fall into
```

Forty checks, all passing. Steps 5 to 7 of the previous version walked a
two-approver chain; under this ladder no invoice needs two signatures, so that
behaviour moved to `lib/approvals/decide-step.test.ts`, where the chain
advancing and one-person-one-signature are tested directly.

### Seeded data

284 invoices across six months (264 active, 20 archived) · 12 vendors · 6 users ·
816 line items · 256 approval steps · 161 payments in 15 batch runs ·
420 notifications · 1,129 audit entries.

The ledger runs to ₱331M over six months, with a median invoice of ₱571,175 and
29 invoices — about one in ten — above the ₱3,000,000 owner-authorisation line.

**Why still 284 invoices against a third as many suppliers?** Because 284 ÷ 12
is about 24 invoices per supplier over six months, roughly one a week each,
which is what a mid-size AP function actually looks like. Twelve suppliers each
billing twice a year would not exercise anything.

Generated from a fixed seed, so re-running produces the same ledger. The
invariants above enforce that it is internally consistent — approval chains
match the threshold rules that would have routed them, payments exist only on
payable invoices, VAT is either zero or exactly 12% of the subtotal, no InstaPay
payment exceeds the ₱1,000,000 rail ceiling, and every audit entry corresponds
to a change actually present in the data.

---

## Defects found and fixed

Found by the verification scripts, not by eyeballing screens.

| # | Defect | Consequence | Fix |
|---|---|---|---|
| 1 | `PAYMENT_SCHEDULED` audit entries stamped with the payment's *execution* date rather than when it was scheduled | Activity feed showed events dated up to 12 days in the future | Separated the two instants; added a future-timestamp invariant |
| 2 | No seeded invoice under $1,000 | The auto-approve tier was never exercised — a whole branch of routing undemonstrated | Added the small-ticket tail real AP actually has. *The auto-approve tier this was written for has since been retired from the default ladder; the small-ticket tail stays, because a ₱1,500 courier bill now needs a signature and the ledger should show invoices that small* |
| 3 | "146 days overdue" shown on rejected invoices | Invented a liability that does not exist | Due-state now only shown for unsettled commitments |
| 4 | Duplicate React key in the login approval trail | Console error on every auth page | Keyed by index, which is what distinguishes two "Approved" steps |
| 5 | Lightest ageing bar invisible against its track | The largest bucket disappeared from the chart | Darkened the first ramp step |
| 6 | Two competing primary buttons (header + page header) | Broke the single-accent discipline the brief mandates | Removed the global header button; each screen owns its primary action |
| 7 | OCR read the street address as a $400 line item, the phone number as $142, and the invoice-number line as $184 | Three fabricated charges in every scanned draft, each plausible enough to survive a glance, silently inflating the subtotal | A line item's amount must be written to the cent; added seven tests pinning the letterhead, contact block, and footer |
| 8 | OCR matched "PO" inside "Harbour **Po**int Drive" and captured `"int"` as the PO number | Garbage in a field an approver matches against | Word-boundary lookahead plus a digit requirement on reference numbers |
| 9 | `next dev` and `next start` share `.next`, so the dev server clobbered the production build | Production served a corrupt build (500s on every route) | Stop the dev server before building for production; documented below |
| 10 | `reconcileTotals` raised confidence when subtotal + VAT matched the total, but never lowered it when they disagreed | The scanner read a bold `2,940,000.00` as `2,040,000.00` and presented it as *"Read confidently (85%)"*. Recognition confidence reports how sure the engine is of the glyphs it saw, which is no help when it saw them wrongly — the arithmetic on the page disproved the figure and nothing acted on it | Contradictory totals now drop all three figures below the review threshold, so a person is asked. The parser still reports what it read rather than inventing a corrected total, because guessing it from the other two would hide a misread subtotal |
| 11 | `DecisionPanel` used one module-level `id` for its reject form, and the approvals queue renders one panel per row | Every row's dialog button resolved to the *first* row's form, so rejecting from any row but the top one acted on the wrong invoice | Form ids are now per-instance via `useId` |

---

## Decisions and assumptions

| Decision | Reasoning | Reversible? |
|---|---|---|
| **Next.js 15 and Prisma 6**, not 16 and 7 | Both majors shipped after my knowledge cutoff. Pinning to versions I know well spends effort on your features rather than on discovering breaking changes | Yes — say the word |
| **Money as integer cents**, never float | A rounding error in an AP ledger is not a cosmetic bug | No — baked into the schema |
| **Simulated payments** | No payment rail or Stripe integration; execution is a state machine | Requires reworking the payments layer to make real |
| **Single tenant** | One organisation, no company switching. Vendor-portal access was explicitly deferred in planning | Would need vendor scoping on every query |
| **SQLite + in-process SSE** | Suits single-instance deployment | Multi-instance needs Postgres and Redis pub/sub — a swap at two seams, not a rewrite |
| **Separation of duties enforced server-side, no exemptions** | The person who enters an invoice can never approve it. Admin included | No — this is the control an auditor tests |
| **Two typefaces split by job** | Inter for the interface and all quantities; IBM Plex Mono for identifiers you would read aloud character by character | Cosmetic |
| **Philippine pesos, PH suppliers, 12% VAT** | The system starts at Philippine scope, so the money, the supplier book, the payment rails and the tax all match it. VAT registration belongs to the supplier, not the invoice — three of the twelve are not registered and bill none | Yes, but it is a wide change |
| **No auto-approve band — approval required from ₱0 up** | A ₱480 courier bill is signed by a person exactly as a ₱4,000,000 one is. The engine still supports auto-approve and an Admin can configure a band; only the shipped default ladder drops it | Yes — one entry in `DEFAULT_TIERS` |
| **₱3,000,000 escalation is a warning, not a record** | Above it the approver must obtain the owner's authorisation. The owner is not a user of this system: they authorise offline, nothing about their decision is recorded, and the approver's signature is the only one on file. Consequently **no invoice now requires two signatures in-system** | Yes — set `requiredApprovals: 2` on the escalation tier |
| **`Cents` kept as the minor-unit suffix** | The peso's minor unit is the sentimo, but renaming nine schema columns and several hundred call sites buys nothing and swamps the diff. Treated as the generic name for minor units, and said so in the schema | Yes, mechanically |
| **The PDF prints `PHP 1,234.56`, not `₱1,234.56`** | jsPDF registers its built-in faces as WinAnsi-encoded and WinAnsi has no glyph for ₱. The alternative is a 60–300 KB subsetted font shipped to every browser that opens an invoice, for one character | Yes, by embedding a Unicode font |
| **InstaPay's ₱1,000,000 ceiling is respected, not enforced** | It is shown in the method description and the seed routes larger payments to PESONet. Blocking a payment on behalf of a rail the system never actually contacts would invent a control it cannot honour | Yes, if the rail becomes real |
| **Scanning sends the document to Google** | A local OCR engine kept invoices on the machine but read them badly enough to invent line items from a letterhead and misread a total by nine hundred thousand pesos. A hosted model reads them correctly. There is no version of this that is both accurate and local, so the trade was made deliberately and is stated wherever a user can see it | Yes — the provider is confined to `lib/extract/gemini-client.ts` |
| **The API key decides the data-handling tier** | Google's free tier permits submitted content to be used to improve their products; the paid tier does not. Supplier invoices carry bank details, contract rates and TINs. Nothing in the code can tell the tiers apart, so this is an operational control. **The key currently configured is a free-tier key** — confirmed from a quota error naming `generate_content_free_tier_requests, limit: 20`. Decide whether that is acceptable before scanning real supplier documents | Yes — replace the key |
| **Self-reported confidence is never shown as a number** | The old percentage came from character-level recognition and meant something. A model reports how fluent its answer felt and sits near 95% whether it read correctly or not, so `Scanned · 95%` on a wrong invoice would lend it authority it has not earned. The badge stays, the number goes, and arithmetic reconciliation does the work the number pretended to | Yes, but do not |

---

## Known gaps

1. **Two sidebar links still 404** — `/settings` and `/notifications`, both
   Phase 3. Down from seven. Nothing else on any screen errors.
2. **Scanning accuracy is imperfect on poor documents.** The fixture used for
   testing is a generated document with no skew, shadow, or camera noise — a
   phone photograph of a creased invoice will read worse. The document sits one
   toggle away from the fields it filled so a figure can be checked against it,
   fields the reader was unsure of are marked, and the totals are cross-checked
   arithmetically — that last check is the only one that does not take the
   reader's word for itself.
3. **Supplier documents are sent to Google, currently on the free tier.** This
   is the price of the accuracy in item 2 and it is not reversible by
   configuration. **The free tier permits submitted content to be used to
   improve Google's products; the paid tier does not** — so which key is pasted
   into `GEMINI_API_KEY` decides how supplier bank details, contract rates and
   TINs are treated. The key configured today is free-tier, which also caps
   throughput at 20 requests per minute; exceeding it returns a clean
   "wait a minute" message rather than an error, but it is a real ceiling for
   a clerk working through a stack of invoices.
4. **Demo passwords are seeded in plaintext** in `prisma/seed.ts`. They must
   never ship to a real environment.
5. **Empty states exist but have not been audited across every screen** —
   scheduled as Phase 3 #22.
6. **Scanning needs `GEMINI_API_KEY` and `GEMINI_MODEL`** (see `.env.example`).
   Without them the upload band says so plainly and the form below still works,
   so a fresh clone runs with no key at all — it just cannot scan.

---

## Decisions I need from you

| Question | Why it matters | Default if you don't answer |
|---|---|---|
| Proceed to Phase 3? | Eight deliverables; unblocks the last two dead links | Waiting |
| Upgrade to Next 16 / Prisma 7? | Currency versus churn | Staying on 15 / 6 |
| Is simulated payment execution still right? | Phase 2 built the full state machine behind a simulated rail. Making it real is a change at one seam | Staying simulated |
