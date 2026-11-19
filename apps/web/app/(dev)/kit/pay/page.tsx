import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PayDemo } from "./pay-demo";

export const metadata: Metadata = { title: "Kit · pay", robots: { index: false, follow: false } };

/**
 * The budget payment of M7 on its own, to try Stripe's test cards without the whole wizard.
 * Development only: a production build answers 404.
 */
export default function PayPage(): React.JSX.Element {
  if (process.env.NODE_ENV === "production") notFound();
  return <PayDemo />;
}
