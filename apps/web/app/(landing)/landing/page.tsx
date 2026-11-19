import type { Metadata } from "next";

import { LandingHero } from "@/components/landing/landing-hero";
import { landingCopy } from "@/lib/landing/copy";

import { landingLinks } from "../landing.config";

const { title, description } = landingCopy.meta;

export const metadata: Metadata = {
  // `absolute`: the root layout's template would add the product name a second time.
  title: { absolute: title },
  description,
  openGraph: { type: "website", siteName: "Winz", title, description },
  twitter: { card: "summary_large_image", title, description },
};

/**
 * `/landing`: the page the jury opens first. The sections arrive one prompt at a time (P1 to P5).
 *
 * The wrapper is the size container the sections measure themselves against: `--u` is one pixel of
 * the 1728 px mockup at the width of the page (`cqw` excludes the scrollbar, `vw` does not), and 1:1
 * above 1728 px. A custom property carrying `cqw` is resolved where it is used, so one declaration
 * serves the navigation and every section.
 */
export default function LandingPage(): React.JSX.Element {
  return (
    <div className="@container relative [--u:calc(min(100cqw,1728px)/1728)]">
      <main id="top">
        <LandingHero liveDemoUrl={landingLinks.liveDemoUrl} />
      </main>
    </div>
  );
}
