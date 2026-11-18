import type { Metadata } from "next";
import { Suspense } from "react";

import { Splash } from "@/components/ui/splash";
import { Wizard } from "@/components/wizard/wizard";

export const metadata: Metadata = { title: "New promo" };

/** M3 to M7. `useSearchParams` needs a Suspense boundary in a statically rendered page. */
export default function NewPromoPage(): React.JSX.Element {
  return (
    <Suspense fallback={<Splash />}>
      <Wizard />
    </Suspense>
  );
}
