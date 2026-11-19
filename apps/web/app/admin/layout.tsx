import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DemoModePin } from "@/components/admin/demo-mode-pin";

export const metadata: Metadata = {
  title: "Demo panel",
  // A page for the team running the demo: nothing to index, nothing to preview.
  robots: { index: false, follow: false },
};

/** Every page under `/admin` carries the DEMO MODE band. */
export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      <DemoModePin />
      {children}
    </>
  );
}
