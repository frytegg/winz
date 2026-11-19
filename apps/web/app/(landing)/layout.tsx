import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./landing.css";
import { landingLinks } from "./landing.config";

/**
 * The landing page's own layout (the app is on `/`, the landing on `/landing`).
 *
 * What it does NOT have, on purpose: no sign-in, no tab bar, no 430px column. The root layout still
 * wraps it (Next has no way to opt a route out of the root layout without splitting the app into
 * two root layouts, which would move every app route), so `/landing` is listed in
 * `lib/auth/provider-choice.ts` (the Privy SDK is not loaded) and in `components/ui/app-shell.tsx`
 * (full width). Sora is the root layout's `next/font` (`--font-sora`): a second copy here would only
 * download the same file twice.
 */

// The card image of a link must have an absolute address for a chat or a feed to fetch it. The pages are
// built once, so they cannot read the request's host as a promo's page does: the app's own address, the
// one its QR codes use, stands in. A preview deployment's card therefore points at the production image.
// Here and not on a page: the image convention reaches every route below `/landing`, `/landing/kit` too.
export const metadata: Metadata = {
  ...(landingLinks.appQrUrl === null ? {} : { metadataBase: new URL(landingLinks.appQrUrl) }),
};

// The status bar takes the colour of the hero it sits over. A page that ends on white and lime does
// not want the app's dark colour scheme for its scrollbars either (see landing.css).
export const viewport: Viewport = {
  themeColor: "#1c1b20",
  colorScheme: "light",
};

export default function LandingLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="landing min-h-dvh bg-white text-ink">{children}</div>;
}
