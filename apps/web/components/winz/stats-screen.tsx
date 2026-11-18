"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CashIcon, ReceiptIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";
import { allTimeTotals, averageSale, countsInStats, shareBps } from "@/lib/merchant/stats";

import { LoadError } from "./load-error";
import { MerchantFrame } from "./merchant-header";
import { Money } from "./money";
import { StatTile } from "./stat-tile";

/**
 * MS: what the merchant's promos sold, added up on the device from `GET /api/campaigns` (SCREENS:
 * "Agrégats locaux"). Gross sales, sales, the average sale, and a bar per promo. The coverage cost of
 * each promo is not in the list, so it is not here (DEMANDES-ALEXANDRE, item 10).
 */
export function StatsScreen(): React.JSX.Element {
  const campaigns = useAsync((signal) => apiFetch("campaigns", { signal }), [], { pollMs: 10_000 });
  const list = campaigns.data?.campaigns ?? null;

  const view = useMemo(() => {
    if (list === null) return null;
    const sold = list
      .filter((campaign) => countsInStats(campaign.status))
      .sort((a, b) => (BigInt(b.revenue) > BigInt(a.revenue) ? 1 : -1));
    const totals = allTimeTotals(list);
    const top = sold.length === 0 ? 0n : BigInt(sold[0]?.revenue ?? "0");
    return { sold, totals, average: averageSale(totals), top };
  }, [list]);

  return (
    <MerchantFrame>
      <h1 className="text-step uppercase">{copy.stats.title}</h1>
      {campaigns.error !== null && list === null ? (
        <LoadError error={campaigns.error} onRetry={campaigns.reload} />
      ) : view === null ? (
        <div aria-busy="true" className="grid grid-cols-2 gap-3">
          <Skeleton className="h-[98px] rounded-card-sm" />
          <Skeleton className="h-[98px] rounded-card-sm" />
          <Skeleton className="h-[98px] rounded-card-sm" />
          <Skeleton className="h-[98px] rounded-card-sm" />
        </div>
      ) : view.sold.length === 0 ? (
        <EmptyState
          title={copy.stats.emptyTitle}
          action={<Button href="/new">{copy.stats.emptyCta}</Button>}
        />
      ) : (
        <>
          <p className="-mt-3 text-body text-muted">{copy.stats.allTime}</p>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label={copy.stats.grossSales} icon={CashIcon}>
              <Money micro={view.totals.grossSales} compact />
            </StatTile>
            <StatTile label={copy.stats.sales} icon={ReceiptIcon}>
              {view.totals.sales.toLocaleString("en-US")}
            </StatTile>
            <StatTile label={copy.stats.average} icon={CashIcon}>
              {view.average === null ? "–" : <Money micro={view.average} />}
            </StatTile>
            <StatTile label={copy.stats.promos} icon={ReceiptIcon}>
              {view.totals.campaigns.toLocaleString("en-US")}
            </StatTile>
          </div>

          <section aria-labelledby="per-promo" className="flex flex-col gap-3">
            <div>
              <h2 id="per-promo" className="text-promise uppercase">
                {copy.stats.perPromo}
              </h2>
              <p className="mt-1 text-body text-muted">{copy.stats.perPromoNote}</p>
            </div>
            <ul className="flex flex-col gap-3">
              {view.sold.map((campaign) => (
                <li key={campaign.id}>
                  <Card className="p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-body">{campaign.promise}</p>
                      <p className="figures shrink-0 text-body">{formatMoney(campaign.revenue)}</p>
                    </div>
                    <div
                      role="img"
                      aria-label={copy.stats.barLabel(
                        campaign.promise,
                        formatMoney(campaign.revenue),
                      )}
                      className="mt-3 h-2 overflow-hidden rounded-full bg-card-raised"
                    >
                      <div
                        className="h-full origin-left rounded-full bg-lime"
                        style={{
                          width: `${(shareBps(BigInt(campaign.revenue), view.top) / 100).toString()}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-caption text-muted">
                      {copy.campaigns.salesCount(campaign.sales)}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </MerchantFrame>
  );
}
