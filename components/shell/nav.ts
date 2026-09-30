import {
  Archive,
  Banknote,
  Building2,
  CheckSquare,
  ClipboardList,
  FileCheck,
  FileText,
  LayoutDashboard,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { Action } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Capability required to see this destination. */
  action: Action;
  /** Key into the counts map supplied by the layout. */
  badge?: "approvals";
  /** Matches child routes too, e.g. `/invoices/inv_0001`. */
  matchPrefix?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * The sidebar renders from this and `middleware`/`requireAction` enforce the
 * same `action` values, so a hidden link and a blocked route cannot disagree.
 */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, action: "invoice:view" },
      {
        href: "/invoices",
        label: "Invoices",
        icon: FileText,
        action: "invoice:view",
        matchPrefix: true,
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: CheckSquare,
        action: "invoice:approve",
        badge: "approvals",
      },
      {
        href: "/payments",
        label: "Payments",
        icon: Banknote,
        action: "payment:view",
        matchPrefix: true,
      },
      {
        href: "/vendors",
        label: "Vendors",
        icon: Building2,
        action: "vendor:view",
        matchPrefix: true,
      },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/archive", label: "Archive", icon: Archive, action: "invoice:view" },
      { href: "/audit", label: "Audit log", icon: ScrollText, action: "audit:view" },
    ],
  },
  {
    label: "Procurement",
    items: [
      {
        href: "/purchase-requests",
        label: "Purchase Requests",
        icon: ClipboardList,
        action: "purchaseRequest:view",
        matchPrefix: true,
      },
      {
        href: "/purchase-orders",
        label: "Purchase Orders",
        icon: FileCheck,
        action: "purchaseOrder:view",
        matchPrefix: true,
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        action: "invoice:view",
        matchPrefix: true,
      },
    ],
  },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.matchPrefix) && pathname.startsWith(`${item.href}/`);
}
