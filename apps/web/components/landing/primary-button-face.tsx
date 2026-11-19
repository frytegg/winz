import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import {
  primaryButtonArrow,
  primaryButtonKnob,
  type PrimaryButtonState,
} from "./primary-button-styles";

/** The inside of the pill: the label, then the black round with its lime arrow. */
export function PrimaryButtonFace({
  state,
  children,
}: {
  state: PrimaryButtonState;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <span>{children}</span>
      <span className={primaryButtonKnob({ state })} aria-hidden="true">
        <ArrowUpRight className={primaryButtonArrow({ state })} strokeWidth={1} />
      </span>
    </>
  );
}
