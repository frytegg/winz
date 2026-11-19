import type { Metadata } from "next";

import { CampaignsScreen } from "@/components/winz/campaigns-screen";

export const metadata: Metadata = { title: "Promos" };

/** MC. */
export default function CampaignsPage(): React.JSX.Element {
  return <CampaignsScreen />;
}
