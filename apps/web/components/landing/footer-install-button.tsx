"use client";

import { Smartphone } from "lucide-react";

import { landingCopy } from "@/lib/landing/copy";
import { isUsableLink } from "@/lib/landing/links";

import { useInstall } from "./install-provider";

const { footer } = landingCopy;

const PILL =
  "inline-flex h-12 items-center justify-center gap-2.5 rounded-full border border-landing-line bg-white px-6 text-base text-ink no-underline";

/**
 * The footer's "Add to Home Screen". A link to the app first (with no script it opens it), and the install
 * sheet once the page is alive: on a desktop the QR straight away, on a phone the sheet of the platform
 * (`footerClickOutcome`). Inactive, and saying so, while `appInstallUrl` is not decided.
 */
export function FooterInstallButton({ url }: { url: string | null }): React.JSX.Element {
  const { onFooterClick } = useInstall();

  if (!isUsableLink(url)) {
    return (
      <div>
        <span aria-disabled="true" className={`${PILL} cursor-not-allowed text-landing-gray`}>
          <Smartphone className="size-5" strokeWidth={1.5} aria-hidden="true" />
          {footer.app.button}
        </span>
        <p className="mt-2 text-sm text-landing-gray">{landingCopy.openingSoon}</p>
      </div>
    );
  }

  return (
    <a
      href={url.trim()}
      target="_blank"
      rel="noopener noreferrer"
      aria-haspopup="dialog"
      onClick={onFooterClick}
      className={`${PILL} transition-[transform,border-color] duration-150 hover:border-ink/30 active:scale-[0.98] motion-reduce:active:scale-100`}
    >
      <Smartphone className="size-5" strokeWidth={1.5} aria-hidden="true" />
      {footer.app.button}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
