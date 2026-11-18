import type { Metadata } from "next";

import { BusinessForm } from "./business-form";

export const metadata: Metadata = { title: "Your business" };

/** M2. */
export default function BusinessPage(): React.JSX.Element {
  return <BusinessForm />;
}
