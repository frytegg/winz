import type { Metadata } from "next";

import { SettingsScreen } from "@/components/winz/settings-screen";

export const metadata: Metadata = { title: "Settings" };

/** Settings. */
export default function SettingsPage(): React.JSX.Element {
  return <SettingsScreen />;
}
