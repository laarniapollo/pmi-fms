"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Click-triggered menu. Closes on Escape, on outside click, and after any
 * item is chosen. Deliberately small: the app needs a menu, not a combobox.
 */
export function Dropdown({
  trigger,
  children,
  align = "end",
  className,
  menuClassName,
}: {
  trigger: (props: { open: boolean }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="block rounded"
      >
        {trigger({ open })}
      </button>

      {open ? (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            "absolute z-50 mt-1 min-w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-overlay",
            "animate-[dropdown-in_100ms_ease-out]",
            align === "end" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          {children}
          <style>{`
            @keyframes dropdown-in {
              from { opacity: 0; transform: translateY(-2px); }
              to   { opacity: 1; transform: none; }
            }
          `}</style>
        </div>
      ) : null}
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-subtle";

export function DropdownItem({
  children,
  onClick,
  danger,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      role="menuitem"
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(ITEM, danger && "text-danger hover:bg-danger-soft")}
    >
      {children}
    </button>
  );
}

export function DropdownLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link role="menuitem" href={href} className={ITEM}>
      {children}
    </Link>
  );
}

export function DropdownDivider() {
  return <div className="my-1 border-t border-line" role="separator" />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-1.5 col-head">{children}</div>;
}
