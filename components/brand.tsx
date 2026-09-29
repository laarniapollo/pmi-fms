import Image from "next/image";

import { cn } from "@/lib/utils";
import logo from "@/assets/pmi_logo.png";
import mark from "@/assets/pmi_mark.png";

/**
 * The square mark is the "P" lifted from the PoultryMax wordmark, white on the
 * logo's own green. It stands in wherever the full wordmark will not fit: the
 * collapsed sidebar and the browser tab (app/icon.png is the same image).
 */
export function Logo({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <Image
      src={mark}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
  );
}

export function Wordmark({
  className,
  inverse = false,
  size = "md",
}: {
  className?: string;
  inverse?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  // Heights of the wordmark image; the old square mark's sizes, so the
  // header rows it sits in keep their rhythm.
  const heights = { sm: 18, md: 22, lg: 26 } as const;
  const text = { sm: "text-sm", md: "text-base", lg: "text-lg" } as const;
  const height = heights[size];

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <span className="inline-flex items-end gap-1.5">
        <Image
          src={logo}
          alt="PoultryMax"
          height={height}
          width={Math.round((height * logo.width) / logo.height)}
          priority
          className="shrink-0"
        />
    <span
          className={cn(
            "font-semibold leading-none tracking-tight",
            text[size],
            inverse ? "text-white/50" : "text-ink-subtle",
          )}
        >
          FMS
        </span> 
      </span> 
      <span
        className={cn(
          "text-2xs leading-none tracking-wide whitespace-nowrap",
          inverse ? "text-white/50" : "text-ink-subtle",
        )}
      >
        Financial Management System
      </span>
    </span>
  );
}
