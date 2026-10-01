import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import { requireAction } from "@/lib/auth/session";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Purchase Requests" };

export default async function PurchaseRequestsPage() {
  await requireAction("purchaseRequest:view");

  return (
    <>
      <PageHeader
        title="Purchase Requests"
        description="Submit and track purchase requests for goods and services."
      />

      <EmptyState
        icon={ClipboardList}
        title="No purchase requests yet"
        description="Purchase requests will appear here once they are submitted."
      />
    </>
  );
}
