import type { Metadata } from "next";

import { BalanceScreen } from "@/components/winz/balance-screen";

export const metadata: Metadata = { title: "Balance" };

/** The "Balance" tab. */
export default function BalancePage(): React.JSX.Element {
  return <BalanceScreen />;
}
