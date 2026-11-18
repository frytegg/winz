"use client";

import { useEffect, useId, useRef, type ComponentPropsWithRef } from "react";

import { usePrefersReducedMotion } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface FieldProps extends Omit<ComponentPropsWithRef<"input">, "id"> {
  /** The caps label above the field. */
  label: string;
  /** An error message: turns the outline red and is announced. */
  error?: string;
  hint?: string;
  /** Plays the 200ms shake once each time it changes (a wrong code). */
  shakeKey?: number;
}

const SHAKE = [
  { transform: "translateX(0)" },
  { transform: "translateX(-6px)" },
  { transform: "translateX(6px)" },
  { transform: "translateX(0)" },
];

/**
 * A pill field, 48px high, 16px text (iOS zooms into anything smaller). Set `type`, `inputMode`,
 * `autoComplete` and `enterKeyHint` for the keyboard the field needs.
 */
export function Field({
  label,
  error,
  hint,
  shakeKey,
  className,
  ref,
  ...input
}: FieldProps): React.JSX.Element {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  const inner = useRef<HTMLInputElement | null>(null);
  const reduced = usePrefersReducedMotion();

  // The shake runs on the live element (Web Animations): remounting the input to replay a CSS
  // animation would drop the focus and the text being typed.
  useEffect(() => {
    if (shakeKey === undefined || reduced) return;
    inner.current?.animate(SHAKE, { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }, [shakeKey, reduced]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-label uppercase text-text">
        {label}
      </label>
      <input
        ref={(node) => {
          inner.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={message === undefined ? undefined : messageId}
        className={cn(
          "h-12 w-full rounded-full border bg-transparent px-5 text-text placeholder:text-muted",
          "outline-none transition-colors duration-150 ease-out",
          "focus-visible:border-lime focus-visible:ring-1 focus-visible:ring-lime",
          "disabled:opacity-50",
          error === undefined ? "border-stroke" : "border-danger",
        )}
        {...input}
      />
      {message === undefined ? null : (
        <p
          id={messageId}
          role={error === undefined ? undefined : "alert"}
          className={cn("px-2 text-caption", error === undefined ? "text-muted" : "text-danger")}
        >
          {message}
        </p>
      )}
    </div>
  );
}
