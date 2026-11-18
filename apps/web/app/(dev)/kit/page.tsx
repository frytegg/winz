import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KitDemo } from "./kit-demo";

export const metadata: Metadata = { title: "Kit", robots: { index: false, follow: false } };

/** The component kit, for design review. Development only: a production build answers 404. */
export default function KitPage(): React.JSX.Element {
  if (process.env.NODE_ENV === "production") notFound();
  return <KitDemo />;
}
