import type { Metadata } from "next";

import { LiveScreen } from "@/components/winz/live-screen";

export const metadata: Metadata = { title: "Your promo is live" };

/** M8. */
export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <LiveScreen campaignId={id} />;
}
