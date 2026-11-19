import type { Metadata } from "next";

import { HomeScreen } from "@/components/winz/home-screen";

export const metadata: Metadata = { title: "Home" };

/** MH. */
export default function HomePage(): React.JSX.Element {
  return <HomeScreen />;
}
