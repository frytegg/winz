import type { Metadata } from "next";

import { TicketsScreen } from "@/components/winz/tickets-screen";
import { copy } from "@/lib/copy";

/** C4, « My tickets »: a person's own tickets, behind the sign-in. Never indexed. */
export const metadata: Metadata = {
  title: copy.tickets.title,
  robots: { index: false, follow: false },
};

export default function TicketsPage(): React.JSX.Element {
  return <TicketsScreen />;
}
