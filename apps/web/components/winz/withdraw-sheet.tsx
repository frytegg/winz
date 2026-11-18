"use client";

import { useToast } from "@/components/ui/toast";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";

import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";

/**
 * "Withdraw": there is no withdrawal route in the API, so this is a simulation and says so (SCREENS,
 * MH). The sheet explains that no money moves, shows what would be withdrawn, and confirms with a toast.
 */
export function WithdrawSheet({
  open,
  onOpenChange,
  available,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Micro-USDC available now. */
  available: string;
}): React.JSX.Element {
  const toast = useToast();
  const hasMoney = BigInt(available) > 0n;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.home.withdrawTitle}
      description={copy.home.withdrawBody}
    >
      <div className="flex flex-col gap-4">
        {hasMoney ? (
          <p className="figures text-lead">{copy.home.withdrawAmount(formatMoney(available))}</p>
        ) : null}
        <Button
          onClick={() => {
            toast.show(copy.home.withdrawDone);
            onOpenChange(false);
          }}
        >
          {copy.home.withdrawConfirm}
        </Button>
      </div>
    </Sheet>
  );
}
