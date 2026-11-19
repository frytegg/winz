import type { Metadata } from "next";

import { landingCopy } from "@/lib/landing/copy";

const { title, description } = landingCopy.meta;

export const metadata: Metadata = {
  // `absolute`: the root layout's template would add the product name a second time.
  title: { absolute: title },
  description,
  openGraph: { type: "website", siteName: "Winz", title, description },
  twitter: { card: "summary_large_image", title, description },
};

/**
 * `/landing`: the page the jury opens first. The sections arrive one prompt at a time (P1 to P5);
 * for now this is the empty page the layout, the tokens, the button and the metadata stand on.
 */
export default function LandingPage(): React.JSX.Element {
  return <main id="top" />;
}
