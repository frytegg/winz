import type { Metadata } from "next";

import { StatsScreen } from "@/components/winz/stats-screen";

export const metadata: Metadata = { title: "Statistics" };

/** MS. */
export default function StatsPage(): React.JSX.Element {
  return <StatsScreen />;
}
