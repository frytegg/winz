import type { ReactNode } from "react";

import { WizardProvider } from "@/components/wizard/wizard-context";

/** The wizard's choices outlive each step, and M8 clears them once the promo exists. */
export default function NewLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <WizardProvider>{children}</WizardProvider>;
}
