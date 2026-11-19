import type { Metadata } from "next";

import { CampaignDetailScreen } from "@/components/winz/campaign-detail-screen";

export const metadata: Metadata = { title: "Promo" };

/** MD. */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <CampaignDetailScreen campaignId={id} />;
}
