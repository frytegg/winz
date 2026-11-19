import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";

import { landingCopy } from "@/lib/landing/copy";
import { cn } from "@/lib/utils";

import { PrimaryButtonFace } from "./primary-button-face";
import { InactivePrimaryButton } from "./primary-button-inactive";
import { resolvePrimaryButton } from "./primary-button-state";
import { primaryButton, type PrimaryButtonTone } from "./primary-button-styles";

export interface PrimaryButtonProps {
  /** The label ("Try the live demo", "View the code"). */
  children: ReactNode;
  /**
   * Where it goes. `null` (a link not decided yet) or anything unusable (`#`, ``) makes the button
   * inactive: it is never a link to `#`.
   */
  href?: string | null;
  /** Open in a new tab. Defaults to true for an absolute URL, false for a path of this site. */
  external?: boolean;
  /**
   * What it does instead of going somewhere (the install sheet of "Try the live demo"). Pass it from
   * a client component: a server component cannot hand a function to a button.
   */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Show it inactive whatever else is set (for "Try the live demo": `liveDemoUrl` is null). */
  unavailable?: boolean;
  /** What an inactive button says under itself. */
  hint?: string;
  /** The section it sits on, for the focus ring: `on-dark` (lime), `on-light` (ink). */
  tone?: PrimaryButtonTone;
  className?: string;
}

/**
 * The landing's primary button: a lime pill and a black round with a lime arrow. One component for
 * every "Try the live demo" and for "View the code". Three shapes, picked by `resolvePrimaryButton`:
 * a link, an action button, or an inactive one. A server component unless it is inactive.
 */
export function PrimaryButton({
  children,
  href,
  external,
  onClick,
  unavailable,
  hint = landingCopy.openingSoon,
  tone = "on-dark",
  className,
}: PrimaryButtonProps): React.JSX.Element {
  const shape = resolvePrimaryButton({
    href,
    external,
    unavailable,
    hasAction: onClick !== undefined,
  });
  const classes = cn(primaryButton({ state: "active", tone }), className);

  if (shape.kind === "inactive") {
    return (
      <InactivePrimaryButton hint={hint} tone={tone} className={className}>
        {children}
      </InactivePrimaryButton>
    );
  }

  if (shape.kind === "link") {
    const face = <PrimaryButtonFace state="active">{children}</PrimaryButtonFace>;
    if (shape.external) {
      return (
        <a href={shape.href} target="_blank" rel="noopener noreferrer" className={classes}>
          {face}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    }
    return (
      <Link href={shape.href} className={classes}>
        {face}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      <PrimaryButtonFace state="active">{children}</PrimaryButtonFace>
    </button>
  );
}
