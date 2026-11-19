"use client";

import { Share } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackButton, IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { isRunning, showsCountdown } from "@/lib/merchant/campaigns";
import { shownChance } from "@/lib/merchant/live-detail";
import { isPulsing, statusBadge } from "@/lib/merchant/status";
import { useCampaignDetail } from "@/lib/merchant/use-campaign-detail";
import { useOddsHistory } from "@/lib/merchant/use-odds-history";
import { useLiveOdds } from "@/lib/realtime/use-live-odds";

import { CampaignHero } from "./campaign-hero";
import { CampaignMatch } from "./campaign-match";
import { CampaignShareSheet } from "./campaign-share-sheet";
import { BudgetTab, ControlsTab, StatsTab } from "./campaign-tabs";
import { LoadError } from "./load-error";
import { MerchantHeader } from "./merchant-header";
import { TopUpSheet } from "./top-up-sheet";

type Tab = "stats" | "budget" | "controls";

const TAB_OPTIONS = [
  { value: "stats", label: copy.campaignDetail.tabs.stats },
  { value: "budget", label: copy.campaignDetail.tabs.budget },
  { value: "controls", label: copy.campaignDetail.tabs.controls },
] as const satisfies readonly { value: Tab; label: string }[];

function DetailSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-[168px] rounded-card" />
      <Skeleton className="h-[290px] rounded-card" />
      <Skeleton className="h-[52px] rounded-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[98px] rounded-card-sm" />
        <Skeleton className="h-[98px] rounded-card-sm" />
      </div>
    </div>
  );
}

/**
 * MD: one campaign, live. The status and the countdown, the game, then the Stats, Budget and
 * Controls tabs. The campaign follows its public row pushed by Supabase Realtime and is read again
 * every 2 to 3 seconds (`useCampaignDetail`); the live chance moves with the live feed (or a small
 * wobble in simulated mode) and builds the chart. When a read fails, the last figures stay under a
 * « reconnecting » line and the chance shows as updating. A tab change keeps its place on screen.
 */
export function CampaignDetailScreen({ campaignId }: { campaignId: string }): React.JSX.Element {
  const { me } = useAuth();
  const detail = useCampaignDetail(campaignId, true);
  const { campaign } = detail;
  const [tab, setTab] = useState<Tab>("stats");
  const [shareOpen, setShareOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const tracking =
    campaign !== null &&
    (isRunning(campaign.status) || campaign.status === "sales_closed") &&
    campaign.probabilityBps !== null;
  const odds = useLiveOdds(
    campaign?.instrumentSymbol ?? null,
    campaign?.probabilityBps ?? null,
    tracking,
  );
  // A failed re-read hides the chance rather than leave an old one that looks current.
  const liveBps = shownChance(odds.bps, tracking, detail.stale);
  const points = useOddsHistory(campaignId, liveBps, tracking);

  const notFound = isApiError(detail.error) && detail.error.status === 404;
  const merchantName = me?.merchant?.name ?? "";

  return (
    <div className="flex min-h-dvh flex-col px-5 pb-nav">
      <MerchantHeader sticky />
      <main className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <BackButton href="/campaigns" />
          {campaign?.url == null ? null : (
            <IconButton
              icon={Share}
              label={copy.campaignDetail.share}
              onClick={() => setShareOpen(true)}
            />
          )}
        </div>

        {notFound && campaign === null ? (
          <Card className="p-6">
            <div className="flex flex-col items-start gap-4">
              <h1 className="text-title">{copy.campaignDetail.notFoundTitle}</h1>
              <p className="text-body text-muted">{copy.campaignDetail.notFoundBody}</p>
              <Button href="/campaigns" variant="dark" size="md" arrow={false}>
                {copy.campaignDetail.allPromos}
              </Button>
            </div>
          </Card>
        ) : detail.error !== null && campaign === null ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : campaign === null ? (
          <DetailSkeleton />
        ) : (
          <>
            <h1 className="sr-only">{campaign.promise}</h1>
            <CampaignHero
              promise={campaign.promise}
              merchantName={merchantName}
              statusLabel={statusBadge(campaign.status)}
              pulsing={isPulsing(campaign.status)}
              closesAt={showsCountdown(campaign.status) ? campaign.salesCloseAt : undefined}
            />
            <CampaignMatch event={campaign.event} startsAt={campaign.startsAt} />
            {detail.stale ? (
              <p
                role="status"
                className="flex items-center gap-2.5 rounded-full bg-card px-4 py-2 text-caption text-muted"
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
                {copy.campaignDetail.reconnecting}
              </p>
            ) : null}
            <Segmented
              semantics="tabs"
              label={copy.campaignDetail.tabsLabel}
              options={TAB_OPTIONS}
              value={tab}
              onChange={setTab}
            />
            <div role="tabpanel" aria-label={copy.campaignDetail.tabs[tab]}>
              {tab === "stats" ? (
                <StatsTab campaign={campaign} points={points} liveBps={liveBps} />
              ) : tab === "budget" ? (
                <BudgetTab campaign={campaign} onAddBudget={() => setTopUpOpen(true)} />
              ) : (
                <ControlsTab campaign={campaign} act={detail.act} />
              )}
            </div>

            {campaign.url === null ? null : (
              <CampaignShareSheet
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={campaign.url}
                slug={campaign.slug}
                promise={campaign.promise}
                merchantName={merchantName}
              />
            )}
            <TopUpSheet
              open={topUpOpen}
              onOpenChange={setTopUpOpen}
              campaignId={campaign.id}
              onAdded={detail.reload}
            />
          </>
        )}
      </main>
    </div>
  );
}
