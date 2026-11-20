"use client";

import { Smartphone } from "lucide-react";
import type { ReactNode } from "react";

import { landingCopy } from "@/lib/landing/copy";
import { isUsableLink } from "@/lib/landing/links";

import { useInstall } from "./install-provider";
import { PrimaryButton } from "./primary-button";
import type { PrimaryButtonTone } from "./primary-button-styles";

const { install } = landingCopy;

export interface TryDemoButtonProps {
  /** `landingLinks.liveDemoUrl`: `null` makes the button inactive ("Opening soon"), never a dead link. */
  href: string | null;
  tone?: PrimaryButtonTone;
  /**
   * Add "Best on your phone" beside the button on a desktop: a small link that opens the QR panel. The
   * navigation leaves it out (its row has no room for it), the hero and the Demo have.
   */
  bestOnPhone?: boolean;
  children: ReactNode;
}

/**
 * "Try the live demo" (the navigation, the hero, the Demo section). A link first: with no script, or before
 * the page has read the browser, it opens the app in a new tab. Once the page knows the platform, a phone
 * gets the install sheet instead (`demoClickOutcome`) and a desktop keeps the tab, with a QR one click away.
 */
export function TryDemoButton({
  href,
  tone = "on-dark",
  bestOnPhone = false,
  children,
}: TryDemoButtonProps): React.JSX.Element {
  const { platform, onDemoClick, onBestOnPhoneClick } = useInstall();
  const showHint = bestOnPhone && platform === "desktop" && isUsableLink(href);
  const hintTone =
    tone === "on-dark"
      ? "text-white/75 hover:text-white focus-visible:outline-lime"
      : "text-landing-gray hover:text-ink focus-visible:outline-ink";

  return (
    <span className="relative inline-flex">
      <PrimaryButton href={href} external tone={tone} onLinkClick={onDemoClick}>
        {children}
      </PrimaryButton>
      {showHint ? (
        // Beside the button and out of the flow: the button stays where the mockup has it, centered.
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onBestOnPhoneClick}
          className={`absolute left-full top-1/2 ml-5 hidden min-h-11 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md px-1 text-[15px] underline-offset-4 transition-colors hover:underline sm:inline-flex ${hintTone}`}
        >
          <Smartphone className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {install.bestOnPhone}
        </button>
      ) : null}
    </span>
  );
}
