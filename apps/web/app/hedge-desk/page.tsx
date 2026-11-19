import type { Metadata } from "next";

import { HedgeDeskScreen } from "@/components/hedge/hedge-desk-screen";

export const metadata: Metadata = { title: "Hedge desk" };

/** The engine, shown to the jury (U-06). Public: no sign-in, no token. */
export default function HedgeDeskPage(): React.JSX.Element {
  return <HedgeDeskScreen />;
}
