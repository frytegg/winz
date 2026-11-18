import type { ReactNode } from "react";

import { MerchantGuard } from "@/components/winz/merchant-guard";

/** The merchant space: the screens that come after the onboarding, behind the same route guard. */
export default function SpaceLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <MerchantGuard>{children}</MerchantGuard>;
}
