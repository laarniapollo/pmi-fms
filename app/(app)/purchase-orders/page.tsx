import type { Metadata } from "next";
import { FileCheck } from "lucide-react";

import { requireAction } from "@/lib/auth/session";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Purchase Orders" };

export default async function PurchaseOrdersPage() {
  await requireAction("purchaseOrder:view");

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description="Create and monitor purchase orders linked to approved requests."
      />

      <EmptyState
        icon={FileCheck}
        title="No purchase orders yet"
        description="Purchase orders will appear here once they are created."
      />
    </>
  );
}
