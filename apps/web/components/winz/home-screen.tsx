"use client";

import { ArrowDownLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Diagonals } from "@/components/ui/diagonals";
import { EmptyState } from "@/components/ui/empty-state";
import { CashIcon, ReceiptIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { isActivePromo, visibleCampaigns } from "@/lib/merchant/campaigns";
import { isPulsing, statusBadge } from "@/lib/merchant/status";
import { totalsFor, type Period } from "@/lib/merchant/stats";

import { BalanceFigures } from "./balance-figures";
import { CampaignHero } from "./campaign-hero";
import { LoadError } from "./load-error";
import { MerchantHeader } from "./merchant-header";
import { Money } from "./money";
import { SectionHeading } from "./section-heading";
import { StatTile } from "./stat-tile";
import { WithdrawSheet } from "./withdraw-sheet";

const PERIOD_OPTIONS = [
  { value: "month", label: copy.home.periods.month },
  { value: "week", label: copy.home.periods.week },
  { value: "today", label: copy.home.periods.today },
] as const satisfies readonly { value: Period; label: string }[];

/** MH: the balance, the statistics of a period, and the promos on sale. */
export function HomeScreen(): React.JSX.Element {
  const { me } = useAuth();
  const campaigns = useAsync((signal) => apiFetch("campaigns", { signal }), [], { pollMs: 10_000 });
  const [period, setPeriod] = useState<Period>("month");
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // An unpaid promo older than the grace period is not "going live": it is hidden.
  const list = useMemo(
    () => (campaigns.data === null ? null : visibleCampaigns(campaigns.data.campaigns, new Date())),
    [campaigns.data],
  );
  const totals = useMemo(
    () => (list === null ? null : totalsFor(list, period, new Date())),
    [list, period],
  );
  const active = useMemo(
    () => (list === null ? null : list.filter((campaign) => isActivePromo(campaign.status))),
    [list],
  );
  const available = me?.balance?.available ?? "0";
  const pending = me?.balance?.pending ?? "0";

  return (
    <div className="flex min-h-dvh flex-col pb-nav">
      <section className="relative overflow-hidden rounded-b-screen bg-card-raised px-5 pb-6 pt-[calc(var(--safe-top)+1.25rem)]">
        <Diagonals className="opacity-90" />
        <div className="relative">
          <MerchantHeader compactPill />
          <div className="mt-6">
            <BalanceFigures available={available} pending={pending} />
          </div>
          <div className="mt-6 flex gap-3">
            <Button size="md" icon={ArrowDownLeft} onClick={() => setWithdrawOpen(true)}>
              {copy.home.withdraw}
            </Button>
            <Button size="md" variant="white" href="/new">
              {copy.home.newPromo}
            </Button>
          </div>
        </div>
      </section>

      <main className="flex flex-1 flex-col gap-4 px-5 pt-8">
        <SectionHeading
          title={copy.home.statistics}
          href="/stats"
          linkLabel={copy.home.statisticsLink}
        />
        <Segmented
          label={copy.home.periodLabel}
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
        />
        <div className="grid grid-cols-2 gap-3" aria-busy={totals === null}>
          {totals === null ? (
            <>
              <Skeleton className="h-[98px] rounded-card-sm" />
              <Skeleton className="h-[98px] rounded-card-sm" />
            </>
          ) : (
            <>
              <StatTile label={copy.home.grossSales} icon={CashIcon}>
                <Money micro={totals.grossSales} compact />
              </StatTile>
              <StatTile label={copy.home.sales} icon={ReceiptIcon}>
                {totals.sales.toLocaleString("en-US")}
              </StatTile>
            </>
          )}
        </div>

        <div className="mt-4">
          <SectionHeading
            title={copy.home.activePromos}
            href="/campaigns"
            linkLabel={copy.home.allPromos}
          />
        </div>
        {campaigns.error !== null && list === null ? (
          <LoadError error={campaigns.error} onRetry={campaigns.reload} />
        ) : active === null ? (
          <Skeleton className="h-[200px] rounded-card" />
        ) : list !== null && list.length === 0 ? (
          <EmptyState
            title={copy.home.emptyTitle}
            action={<Button href="/new">{copy.home.emptyCta}</Button>}
          />
        ) : active.length === 0 ? (
          <Card className="p-6">
            <p className="text-body text-muted">{copy.home.noActive}</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-4">
            {active.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/campaigns/${encodeURIComponent(campaign.id)}`}
                  aria-label={copy.campaigns.open(campaign.promise)}
                  className="block rounded-card transition-transform duration-150 ease-out active:scale-[0.985]"
                >
                  <CampaignHero
                    promise={campaign.promise}
                    merchantName={me?.merchant?.name ?? ""}
                    statusLabel={statusBadge(campaign.status)}
                    pulsing={isPulsing(campaign.status)}
                    closesAt={campaign.salesCloseAt}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <WithdrawSheet open={withdrawOpen} onOpenChange={setWithdrawOpen} available={available} />
    </div>
  );
}
