import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { copy } from "@/lib/copy";
import { gameFromEvent } from "@/lib/fan/teams";
import type { TicketRow } from "@/lib/fan/tickets-view";
import { cn } from "@/lib/utils";

import { Card } from "../ui/card";
import { LimePercent } from "../ui/lime-percent";
import { Skeleton } from "../ui/skeleton";

import { TeamBadge } from "./team-badge";

/**
 * A ticket of « My tickets » (C4): its phase in the ticket page's own words, the promise, the two
 * teams, and what was paid or refunded. The whole card opens the live ticket (`/t/<token>`). Built
 * like the merchant's promo card (`campaign-card.tsx`), so that a promo reads the same everywhere.
 */
export function TicketCard({ row }: { row: TicketRow }): React.JSX.Element {
  const teams = gameFromEvent(row.event);
  const live = row.phase === "pre_game" || row.phase === "in_game";
  const won = row.phase === "refunded";
  return (
    <Link
      href={row.href}
      aria-label={copy.tickets.open(row.promise)}
      className="block rounded-card transition-transform duration-150 ease-out active:scale-[0.985]"
    >
      <Card tone="raised" diagonals className="p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex items-center gap-2 text-label uppercase">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                live || won ? "bg-lime" : "bg-muted",
                row.phase === "in_game" && "animate-pulse-dot",
              )}
            />
            {row.phaseLabel}
          </span>
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-ink"
          >
            <ArrowUpRight className="size-4" strokeWidth={1.75} />
          </span>
        </div>

        <h3 className="mt-4 text-promise uppercase">
          <LimePercent text={row.promise} />
        </h3>
        {row.chanceText === null ? null : (
          <p className="mt-2 text-body text-lime">{row.chanceText}</p>
        )}

        <div className="mt-5 flex items-end justify-between gap-3">
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
          <p className="figures min-w-0 text-right text-body">
            <span className="block break-words">{row.merchantName}</span>
            <span className="block break-words text-caption text-muted">{row.item}</span>
            <span className={cn("block text-caption", won ? "text-lime" : "text-muted")}>
              {row.refundText ?? row.paidText}
            </span>
          </p>
        </div>
      </Card>
    </Link>
  );
}

/** A card-shaped placeholder while the list loads. */
export function TicketCardSkeleton(): React.JSX.Element {
  return <Skeleton className="h-[220px] rounded-card" />;
}
