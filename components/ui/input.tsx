"use client";

import { forwardRef, useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded border border-line bg-surface text-sm text-ink transition-colors " +
  "placeholder:text-ink-subtle " +
  "hover:border-line-strong " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring " +
  "disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-subtle";

const INVALID = "border-danger hover:border-danger focus:border-danger focus:ring-danger/20";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  invalid?: boolean;
  /** Leading glyph or unit, e.g. a `₱` on a currency field. */
  leading?: ReactNode;
  /** Trailing unit or hint, e.g. `days` on a terms field. */
  trailing?: ReactNode;
  inputSize?: "sm" | "md";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leading, trailing, inputSize = "md", ...props },
  ref,
) {
  const height = inputSize === "sm" ? "h-7" : "h-8";
  const hasLeading = leading !== undefined && leading !== null;
  const hasTrailing = trailing !== undefined && trailing !== null;

  const field = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        height,
        "px-2.5",
        hasLeading && "pl-7",
        hasTrailing && "pr-8",
        invalid && INVALID,
        className,
      )}
      {...props}
    />
  );

  if (!hasLeading && !hasTrailing) return field;

  return (
    <div className="relative">
      {hasLeading ? (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">
          {leading}
        </span>
      ) : null}
      {field}
      {hasTrailing ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-subtle">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, "resize-y px-2.5 py-1.5 leading-5", invalid && INVALID, className)}
      {...props}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  selectSize?: "sm" | "md";
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, selectSize = "md", ...props },
  ref,
) {
  const height = selectSize === "sm" ? "h-7" : "h-8";
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          height,
          "cursor-pointer appearance-none pl-2.5 pr-7",
          invalid && INVALID,
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
        aria-hidden="true"
      />
    </div>
  );
});

/**
 * Label, control, hint, and error in one unit. Wiring `htmlFor`,
 * `aria-describedby`, and `aria-invalid` here means no form screen has to
 * remember to do it — and none of them can forget.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Receives the generated id so the control can bind to the label. */
  children: ReactNode | ((props: { id: string; describedBy?: string }) => ReactNode);
  className?: string;
  htmlFor?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={id}
        className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-muted"
      >
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {typeof children === "function" ? children({ id, describedBy }) : children}

      {error ? (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: string }) {
  const id = useId();
  return (
    <div className={cn("flex gap-2", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm border-line-strong text-accent accent-[var(--color-accent)]"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm text-ink">
          {label}
        </label>
        {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
      </div>
    </div>
  );
}

/** Compact on/off control for settings rows. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-line-strong bg-neutral-soft",
      )}
    >
      <span
        className={cn(
          "block h-3 w-3 rounded-full bg-white shadow-flat transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
