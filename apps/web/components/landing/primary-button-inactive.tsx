"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { PrimaryButtonFace } from "./primary-button-face";
import {
  primaryButton,
  primaryButtonHint,
  primaryButtonHintWrap,
  type PrimaryButtonTone,
} from "./primary-button-styles";

const HINT_MS = 2500;

/**
 * The button of a link that is not decided yet. It looks like the button (dimmed lime, the label
 * unchanged), says "Opening soon" under itself, and goes nowhere.
 *
 * It stays a focusable `button` with `aria-disabled`, not a `disabled` one: a keyboard or screen-reader
 * user can reach it, and the hint is its description. The hint shows on hover and focus (CSS); a tap
 * shows it for 2.5 s too, because a phone has no hover and Safari does not focus a tapped button.
 * That is why this part, and only this part, is a client component.
 */
export function InactivePrimaryButton({
  children,
  hint,
  tone,
  className,
}: {
  children: ReactNode;
  hint: string;
  tone: PrimaryButtonTone;
  className?: string;
}): React.JSX.Element {
  const hintId = useId();
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span className={cn(primaryButtonHintWrap, className)}>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={hintId}
        className={primaryButton({ state: "inactive", tone })}
        onClick={() => {
          setShown(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setShown(false), HINT_MS);
        }}
      >
        <PrimaryButtonFace state="inactive">{children}</PrimaryButtonFace>
      </button>
      <span id={hintId} role="tooltip" data-shown={shown} className={primaryButtonHint}>
        {hint}
      </span>
    </span>
  );
}
