"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronsLeft, LogOut, Menu, Search, User as UserIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ROLE_META, SIDEBAR_COOKIE, type Role } from "@/lib/constants";
import { can, type Action } from "@/lib/auth/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/badge";
import { Dropdown, DropdownDivider, DropdownItem, DropdownLink } from "@/components/ui/dropdown";
import { Logo, Wordmark } from "@/components/brand";
import { LiveUpdates } from "@/components/realtime/live-updates";
import { NAV, isActive, type NavItem } from "./nav";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
  avatarColor: string;
  isActive: boolean;
}

/**
 * Owns the two pieces of chrome state — the desktop collapse and the mobile
 * drawer — because the header's toggles and the sidebar's width both depend on
 * them. Everything inside `children` stays a server component.
 */
export function AppShell({
  user,
  children,
  initialCollapsed,
  counts,
  onSignOut,
}: {
  user: ShellUser;
  children: ReactNode;
  initialCollapsed: boolean;
  counts: { approvals: number; notifications: number };
  onSignOut: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Navigating on a phone should put the drawer away.
  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [drawerOpen]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      // A cookie rather than localStorage so the server renders the right
      // width on first paint and the sidebar does not jump.
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(user, item.action as Action)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Mobile scrim */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-ink/25 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <Sidebar
        user={user}
        groups={visibleGroups}
        pathname={pathname}
        collapsed={collapsed}
        drawerOpen={drawerOpen}
        counts={counts}
        onToggleCollapsed={toggleCollapsed}
        onCloseDrawer={() => setDrawerOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          notifications={counts.notifications}
          onOpenDrawer={() => setDrawerOpen(true)}
          onSignOut={onSignOut}
        />
        <main className="flex-1 px-4 py-4 sm:px-5">{children}</main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Sidebar({
  user,
  groups,
  pathname,
  collapsed,
  drawerOpen,
  counts,
  onToggleCollapsed,
  onCloseDrawer,
}: {
  user: ShellUser;
  groups: Array<{ label: string | null; items: NavItem[] }>;
  pathname: string;
  collapsed: boolean;
  drawerOpen: boolean;
  counts: { approvals: number };
  onToggleCollapsed: () => void;
  onCloseDrawer: () => void;
}) {
  return (
    <aside
      className={cn(
        "z-50 flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150",
        // Desktop: in flow, width driven by the collapse state.
        "lg:sticky lg:top-0 lg:h-screen",
        collapsed ? "lg:w-14" : "lg:w-58",
        // Mobile: off-canvas drawer at full label width.
        "fixed inset-y-0 left-0 w-58",
        drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        "transition-transform lg:transition-[width]",
      )}
    >
      <div
        className={cn(
          "flex h-13 shrink-0 items-center border-b border-line",
          collapsed ? "lg:justify-center lg:px-0" : "px-3",
        )}
      >
        <Link href="/dashboard" className="flex min-w-0 items-center rounded">
          {collapsed ? (
            <span className="hidden lg:block">
              <Logo size={26} />
            </span>
          ) : null}
          <span className={cn(collapsed && "lg:hidden")}>
            <Wordmark size="lg" />
          </span>
        </Link>

        <button
          type="button"
          onClick={onCloseDrawer}
          aria-label="Close navigation"
          className="ml-auto rounded p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink lg:hidden"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
        {groups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className={groupIndex > 0 ? "mt-4" : ""}>
            {group.label ? (
              <p
                className={cn(
                  "col-head mb-1 px-2",
                  collapsed && "lg:sr-only",
                )}
              >
                {group.label}
              </p>
            ) : null}

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item, pathname);
                const badgeCount = item.badge === "approvals" ? counts.approvals : 0;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                        collapsed && "lg:justify-center lg:px-0",
                      )}
                    >
                      {/* Active rail: a 2px emerald edge, not a filled block. */}
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-accent"
                        />
                      ) : null}

                      <item.icon
                        className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-ink-subtle")}
                        aria-hidden="true"
                      />
                      <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>

                      {badgeCount > 0 ? (
                        collapsed ? (
                          <span
                            aria-label={`${badgeCount} awaiting`}
                            className="absolute right-1.5 top-1.5 hidden h-1.5 w-1.5 rounded-full bg-accent lg:block"
                          />
                        ) : (
                          <CountBadge count={badgeCount} active={active} />
                        )
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line p-2">
        <div
          className={cn(
            "mb-2 flex items-center gap-2 rounded px-1 py-1",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <Avatar name={user.name} color={user.avatarColor} size="sm" />
          <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
            <p className="truncate text-xs font-medium text-ink">{user.name}</p>
            <p className="truncate text-2xs text-ink-subtle">
              {ROLE_META[user.role as Role]?.label ?? user.role}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "hidden w-full items-center gap-2.5 rounded px-2 py-1.5 text-xs text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink lg:flex",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <ChevronsLeft
            className={cn("h-4 w-4 shrink-0 transition-transform", collapsed && "rotate-180")}
            aria-hidden="true"
          />
          <span className={cn(collapsed && "lg:hidden")}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

function Header({
  user,
  notifications,
  onOpenDrawer,
  onSignOut,
}: {
  user: ShellUser;
  notifications: number;
  onOpenDrawer: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur-sm sm:px-4">
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        className="rounded p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* A plain GET form, so search works with JavaScript disabled. */}
      <form action="/search" method="get" className="relative min-w-0 flex-1 sm:max-w-md">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          placeholder="Search invoices, vendors, payments…"
          aria-label="Search"
          className="h-8 w-full rounded border border-line bg-canvas pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle transition-colors hover:border-line-strong focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <LiveUpdates userId={user.id} />

        {/* Each screen owns its own primary action, so the header carries no
            second emerald button competing with it. */}
        <Link
          href="/notifications"
          aria-label={
            notifications > 0 ? `Notifications, ${notifications} unread` : "Notifications"
          }
          className="relative rounded p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {notifications > 0 ? (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface" />
          ) : null}
        </Link>

        <Dropdown
          trigger={() => (
            <span className="flex items-center rounded p-0.5 transition-colors hover:bg-surface-hover">
              <Avatar name={user.name} color={user.avatarColor} size="md" />
            </span>
          )}
        >
          <div className="border-b border-line px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-1 text-2xs text-ink-subtle">
              {ROLE_META[user.role as Role]?.label ?? user.role}
              {user.title ? ` · ${user.title}` : ""}
            </p>
          </div>

          <DropdownLink href="/profile">
            <UserIcon className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
            Profile
          </DropdownLink>
          <DropdownLink href="/settings">
            <span className="w-3.5" />
            Settings
          </DropdownLink>

          <DropdownDivider />

          <form action={onSignOut}>
            <DropdownItem type="submit">
              <LogOut className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
              Sign out
            </DropdownItem>
          </form>
        </Dropdown>
      </div>
    </header>
  );
}

/** Re-exported so screens can render a matching action without importing lucide. */
export { Button };
