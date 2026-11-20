import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KitDemo } from "./kit-demo";

export const metadata: Metadata = { title: "Landing kit", robots: { index: false, follow: false } };

/** The landing's components, for design review. Development only: a production build answers 404. */
export default function LandingKitPage(): React.JSX.Element {
  if (process.env.NODE_ENV === "production") notFound();
  return <KitDemo />;
}
