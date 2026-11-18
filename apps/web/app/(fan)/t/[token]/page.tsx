import type { Metadata } from "next";

import { TicketScreen } from "@/components/winz/ticket-screen";
import { copy } from "@/lib/copy";

/**
 * A ticket's link is its key: whoever holds it sees the ticket. So it is never indexed, and the
 * address is not passed on to the sites a ticket might link to.
 */
export const metadata: Metadata = {
  title: copy.ticket.showAtCounter,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  return <TicketScreen token={token} />;
}
