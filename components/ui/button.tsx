import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Emerald is reserved. `primary` is the only filled-accent control on a
 * screen — if two of them appear together, one of them is the wrong variant.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover active:bg-accent-active disabled:bg-accent/40 disabled:border-transparent",
  secondary:
    "bg-surface text-ink border border-line hover:bg-surface-hover hover:border-line-strong active:bg-canvas",
  ghost:
    "bg-transparent text-ink-muted border border-transparent hover:bg-surface-hover hover:text-ink",
  danger:
    "bg-surface text-danger border border-line hover:bg-danger-soft hover:border-danger/30 active:bg-danger-soft",
  link: "bg-transparent text-accent border border-transparent hover:underline underline-offset-2 p-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-1.5",
  lg: "h-9 px-4 text-base gap-2",
  icon: "h-8 w-8 justify-center",
  "icon-sm": "h-7 w-7 justify-center",
};

const BASE =
  "inline-flex items-center rounded font-medium whitespace-nowrap transition-colors duration-100 " +
  "disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

export interface ButtonProps
  extends CommonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {
  /** Swaps the label for a spinner and blocks repeat submits. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, children, loading, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export interface ButtonLinkProps extends CommonProps {
  href: string;
  prefetch?: boolean;
  target?: string;
  rel?: string;
  title?: string;
  "aria-label"?: string;
}

/** Same appearance as `Button`, but a real anchor — use for navigation. */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 shrink-0 animate-spin", className)}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
