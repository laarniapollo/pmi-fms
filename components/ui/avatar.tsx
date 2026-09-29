import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/**
 * Initials on a flat colour. No photo uploads in this product, so the colour
 * is the identity cue — it comes from the user record and stays stable.
 */
export function Avatar({
  name,
  color = "#5C6470",
  size = "md",
  className,
}: {
  name: string;
  color?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    xs: "h-5 w-5 text-[9px]",
    sm: "h-6 w-6 text-2xs",
    md: "h-7 w-7 text-xs",
    lg: "h-12 w-12 text-base",
  } as const;

  return (
    <span
      aria-hidden="true"
      title={name}
      style={{ backgroundColor: color }}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded font-semibold uppercase leading-none tracking-tight text-white",
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Avatar plus name and secondary line — the standard "who" cell in a table. */
export function UserCell({
  name,
  color,
  secondary,
  className,
}: {
  name: string;
  color?: string;
  secondary?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar name={name} color={color} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink">{name}</span>
        {secondary ? (
          <span className="block truncate text-2xs text-ink-subtle">{secondary}</span>
        ) : null}
      </span>
    </span>
  );
}
