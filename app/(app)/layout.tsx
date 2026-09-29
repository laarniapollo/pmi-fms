import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { SIDEBAR_COOKIE } from "@/lib/constants";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/app-shell";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const cookieStore = await cookies();

  const [approvals, notifications] = await Promise.all([
    // What this person actually owes a decision on — never a global count.
    // An invoice they entered themselves is excluded, matching `can()`.
    can(user, "invoice:approve")
      ? db.invoice.count({
          where: {
            status: "PENDING_APPROVAL",
            archivedAt: null,
            createdById: { not: user.id },
            approvalSteps: { some: { status: "PENDING" } },
          },
        })
      : Promise.resolve(0),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <AppShell
      user={user}
      initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "1"}
      counts={{ approvals, notifications }}
      onSignOut={signOut}
    >
      {children}
    </AppShell>
  );
}
