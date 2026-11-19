import { Clock } from "lucide-react";

import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";

import { Money } from "./money";

/**
 * The balance written large, with what is still waiting under it (SPEC 4.6 asks for both): the
 * available amount, then "$240.00 pending · paid after the games". Used by the home hero and by Balance.
 */
export function BalanceFigures({
  available,
  pending,
}: {
  /** Micro-USDC, available now. */
  available: string;
  /** Micro-USDC, waiting for a game to settle. */
  pending: string;
}): React.JSX.Element {
  const waiting = BigInt(pending) > 0n;
  return (
    <div className="flex flex-col items-center text-center">
      <p className="text-lead text-muted">{copy.home.balance}</p>
      <p className="mt-1 text-figure">
        <Money micro={available} />
      </p>
      <p className="mt-3 flex items-center gap-2 text-body">
        <span
          aria-hidden="true"
          className="grid size-4 place-items-center rounded-full bg-lime text-ink"
        >
          <Clock className="size-2.5" strokeWidth={2} />
        </span>
        <span className="figures">{copy.home.pending(formatMoney(pending))}</span>
        {waiting ? (
          <span className="text-caption text-muted">· {copy.home.pendingNote}</span>
        ) : null}
      </p>
    </div>
  );
}
