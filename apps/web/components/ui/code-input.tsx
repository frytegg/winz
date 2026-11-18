"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

import { copy } from "@/lib/copy";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export const CODE_LENGTH = 6;

interface CodeInputProps {
  /** Up to 6 digits. */
  value: string;
  onChange: (value: string) => void;
  /** Called once, when the sixth digit is in. */
  onComplete: (value: string) => void;
  label: string;
  error?: boolean;
  /** Plays the 200ms shake each time it changes. */
  shakeKey?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

const SHAKE = [
  { transform: "translateX(0)" },
  { transform: "translateX(-6px)" },
  { transform: "translateX(6px)" },
  { transform: "translateX(0)" },
];

/**
 * Six boxes for the e-mailed code (M1). Typing moves forward, Backspace moves back, a pasted code
 * is spread over the boxes, and the one-time-code autofill of iOS and Android fills them all (the
 * boxes have no `maxLength` for that reason: autofill writes the whole code into one of them).
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  error = false,
  shakeKey,
  disabled = false,
  autoFocus = false,
}: CodeInputProps): React.JSX.Element {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const group = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (shakeKey === undefined || reduced) return;
    group.current?.animate(SHAKE, { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    // A wrong code is cleared: start again from the first box.
    refs.current[0]?.focus();
  }, [shakeKey, reduced]);

  function focusBox(index: number): void {
    const box = refs.current[Math.min(CODE_LENGTH - 1, Math.max(0, index))];
    box?.focus();
    box?.select();
  }

  /** Writes `typed` from box `index` on, and moves to the box after the last digit written. */
  function write(index: number, typed: string): void {
    const incoming = typed.replace(/\D/g, "");
    if (incoming === "") return;
    const next = (value.slice(0, index).padEnd(index, " ") + incoming)
      .replace(/ /g, "")
      .slice(0, CODE_LENGTH);
    onChange(next);
    focusBox(Math.min(CODE_LENGTH - 1, index + incoming.length));
    if (next.length === CODE_LENGTH) onComplete(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number): void {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (digits[index] !== "") {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        focusBox(index - 1);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    write(0, event.clipboardData.getData("text"));
  }

  return (
    <div
      ref={group}
      role="group"
      aria-label={label}
      className="flex items-center justify-between gap-2"
    >
      {digits.map((digit, index) => (
        <div key={index} className="contents">
          {index === 3 ? (
            <span aria-hidden="true" className="-mx-0.5 w-2 text-center text-muted">
              –
            </span>
          ) : null}
          <input
            ref={(node) => {
              refs.current[index] = node;
            }}
            aria-label={copy.signIn.codeDigit(index + 1)}
            aria-invalid={error || undefined}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            enterKeyHint="go"
            pattern="[0-9]*"
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            value={digit}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const typed = event.target.value.replace(/\D/g, "");
              // The autofill of a whole code lands in one box: it always starts at the first.
              write(typed.length >= CODE_LENGTH ? 0 : index, typed);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            onPaste={onPaste}
            className={cn(
              "figures h-[70px] min-w-0 flex-1 rounded-2xl border bg-transparent text-center text-title text-text",
              "outline-0 transition-colors duration-150 ease-out",
              "focus-visible:border-lime focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-lime",
              "disabled:opacity-50",
              error ? "border-danger" : "border-stroke",
            )}
          />
        </div>
      ))}
    </div>
  );
}
