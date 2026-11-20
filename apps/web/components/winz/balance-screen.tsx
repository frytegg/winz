"use client";

import { ArrowDownLeft, ChevronRight, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Diagonals } from "@/components/ui/diagonals";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";

import { BalanceFigures } from "./balance-figures";
import { MerchantFrame } from "./merchant-header";
import { WithdrawSheet } from "./withdraw-sheet";

/**
 * The "Balance" tab: the available balance, what is pending, and the
 * simulated withdrawal. The settings are one tap away. "Deposit" of the mockup is not in the spec.
 */
export function BalanceScreen(): React.JSX.Element {
  const { me } = useAuth();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const available = me?.balance?.available ?? "0";
  const pending = me?.balance?.pending ?? "0";

  return (
    <MerchantFrame>
      <h1 className="text-step uppercase">{copy.balance.title}</h1>

      <Card tone="raised" diagonals className="px-5 py-8">
        <BalanceFigures available={available} pending={pending} />
        <div className="mt-6">
          <Button size="md" icon={ArrowDownLeft} onClick={() => setWithdrawOpen(true)}>
            {copy.balance.withdraw}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="divide-y divide-white/10">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-body">{copy.balance.available}</p>
              <p className="text-caption text-muted">{copy.balance.availableNote}</p>
            </div>
            <p className="figures shrink-0 text-lead">{formatMoney(available)}</p>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-body">{copy.balance.pending}</p>
              <p className="text-caption text-muted">{copy.balance.pendingNote}</p>
            </div>
            <p className="figures shrink-0 text-lead">{formatMoney(pending)}</p>
          </div>
        </div>
      </Card>

      <Link
        href="/settings"
        className="relative flex min-h-16 items-center gap-4 overflow-hidden rounded-card bg-card px-5 py-3 transition-transform duration-150 ease-out active:scale-[0.985]"
      >
        <Diagonals className="opacity-60" />
        <Settings className="relative size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="relative min-w-0 flex-1">
          <span className="block text-body">{copy.balance.settings}</span>
          <span className="block text-caption text-muted">{copy.balance.settingsNote}</span>
        </span>
        <ChevronRight
          className="relative size-5 shrink-0 text-muted"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </Link>

      <WithdrawSheet open={withdrawOpen} onOpenChange={setWithdrawOpen} available={available} />
    </MerchantFrame>
  );
}
