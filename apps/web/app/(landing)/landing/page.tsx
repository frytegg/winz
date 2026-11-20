import type { Metadata } from "next";

import { InstallProvider } from "@/components/landing/install-provider";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingDemo } from "@/components/landing/landing-demo";
import { LandingFeatures } from "@/components/landing/landing-features";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHow } from "@/components/landing/landing-how";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingProcess } from "@/components/landing/landing-process";
import { LogoStrip } from "@/components/landing/logo-strip";
import { landingCopy } from "@/lib/landing/copy";
import { EARLY_INSTALL_PROMPT_SCRIPT } from "@/lib/landing/install-early";
import { installTarget } from "@/lib/landing/install-target";
import { qrTarget } from "@/lib/landing/qr-target";

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
 * `/landing`: the page the jury opens first, from the navigation to the footer.
 *
 * The wrapper is the size container the sections measure themselves against: `--u` is one pixel of
 * the 1728 px mockup at the width of the page (`cqw` excludes the scrollbar, `vw` does not), and 1:1
 * above 1728 px. A custom property carrying `cqw` is resolved where it is used, so one declaration
 * serves the navigation and every section.
 *
 * The provider is what the four install buttons share (the three "Try the live demo" and the footer's
 * "Add to Home Screen": `sections/09-install-flow.md`). The small script before it keeps Android's install
 * event from the first moment of the page, which hydration may reach too late.
 */
export default function LandingPage(): React.JSX.Element {
  return (
    <InstallProvider
      demo={installTarget(landingLinks.liveDemoUrl, landingLinks.appQrUrl)}
      footer={installTarget(landingLinks.appInstallUrl, landingLinks.appQrUrl)}
    >
      <script dangerouslySetInnerHTML={{ __html: EARLY_INSTALL_PROMPT_SCRIPT }} />
      <div className="@container relative [--u:calc(min(100cqw,1728px)/1728)]">
        <LandingNav liveDemoUrl={landingLinks.liveDemoUrl} />
        <main id="top">
          <LandingHero liveDemoUrl={landingLinks.liveDemoUrl} />
          <LogoStrip />
          <LandingHow />
          <LandingDemo liveDemoUrl={landingLinks.liveDemoUrl} videoUrl={landingLinks.videoUrl} />
          <LandingProcess qrUrl={qrTarget(landingLinks.liveDemoUrl, landingLinks.appQrUrl)} />
          <LandingFeatures />
          <LandingCta githubUrl={landingLinks.githubUrl} />
        </main>
        <LandingFooter links={landingLinks} />
      </div>
    </InstallProvider>
  );
}
