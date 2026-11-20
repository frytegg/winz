import type { Metadata } from "next";

import { Wizard } from "@/components/wizard/wizard";

export const metadata: Metadata = { title: "New promo" };

/**
 * M3 to M7. `useSearchParams` needs a Suspense boundary in a statically rendered page: the root
 * `loading.tsx` is that boundary, on purpose not one of this page's own. A boundary here was new on
 * every arrival from M2, and React shows a new boundary's fallback at once while the wizard's code
 * loads: the splash flashed between M2 and M3. The root's is already on screen, so the navigation
 * (a transition) keeps M2 in place until M3 is ready.
 */
export default function NewPromoPage(): React.JSX.Element {
  return <Wizard />;
}
