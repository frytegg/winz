import type { CampaignSummary } from "@winz/shared";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { teamsFromTitle } from "@/lib/fan/teams";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";
import { isPulsing, statusBadge } from "@/lib/merchant/status";
import { cn } from "@/lib/utils";

import { Card } from "../ui/card";
import { LimePercent } from "../ui/lime-percent";
import { Skeleton } from "../ui/skeleton";

import { TeamBadge } from "./team-badge";

/**
 * A promo of the list (MC): its status, the promise in capitals, the two teams, and what it sold.
 * The whole card is the link to the detail. The teams are cut out of the title because the list has
 * no sport and no abbreviations (DEMANDES-ALEXANDRE, item 1): football art unless the title is odd.
 */
export function CampaignCard({ campaign }: { campaign: CampaignSummary }): React.JSX.Element {
  const teams = teamsFromTitle(campaign.eventTitle);
  const live = campaign.status === "live";
  return (
    <Link
      href={`/campaigns/${encodeURIComponent(campaign.id)}`}
      aria-label={copy.campaigns.open(campaign.promise)}
      className="block rounded-card transition-transform duration-150 ease-out active:scale-[0.985]"
    >
      <Card tone="raised" diagonals className="p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex items-center gap-2 text-label uppercase">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                live || campaign.status === "settled_yes" ? "bg-lime" : "bg-muted",
                isPulsing(campaign.status) && "animate-pulse-dot",
              )}
            />
            {statusBadge(campaign.status)}
          </span>
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-ink"
          >
            <ArrowUpRight className="size-4" strokeWidth={1.75} />
          </span>
        </div>

        <h2 className="mt-4 text-promise uppercase">
          <LimePercent text={campaign.promise} />
        </h2>

        <div className="mt-5 flex items-end justify-between gap-3">
          {teams === null ? (
            <p className="min-w-0 truncate text-body text-muted">{campaign.eventTitle}</p>
          ) : (
            <div
              role="img"
              aria-label={copy.campaigns.versus(teams.away.name, teams.home.name)}
              className="flex shrink-0 items-center gap-1"
            >
              <div className="flex w-12 flex-col items-center gap-0.5">
                <TeamBadge
                  abbreviation={teams.away.abbreviation}
                  src={teams.away.art}
                  side="a"
                  size={36}
                />
                <span className="text-micro text-muted">{teams.away.abbreviation}</span>
              </div>
              <span
                aria-hidden="true"
                className="mb-4 grid size-6 place-items-center rounded-full bg-lime text-micro font-semibold text-ink"
              >
                {copy.pickGame.vs}
              </span>
              <div className="flex w-12 flex-col items-center gap-0.5">
                <TeamBadge
                  abbreviation={teams.home.abbreviation}
                  src={teams.home.art}
                  side="b"
                  size={36}
                />
                <span className="text-micro text-muted">{teams.home.abbreviation}</span>
              </div>
            </div>
          )}
          <p className="figures shrink-0 text-right text-body">
            <span className="block">{formatMoney(campaign.revenue)}</span>
            <span className="block text-caption text-muted">
              {copy.campaigns.salesCount(campaign.sales)}
            </span>
          </p>
        </div>
      </Card>
    </Link>
  );
}

/** A card-shaped placeholder while the list loads. */
export function CampaignCardSkeleton(): React.JSX.Element {
  return <Skeleton className="h-[200px] rounded-card" />;
}
