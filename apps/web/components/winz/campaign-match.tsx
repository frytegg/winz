import type { CampaignEvent } from "@winz/shared";

import { copy } from "@/lib/copy";
import { gameFromEvent } from "@/lib/fan/teams";

import { Card } from "../ui/card";
import { LocalTime } from "../ui/local-time";
import { SPORT_ICONS } from "../ui/sport-icons";

import { TeamBadge } from "./team-badge";

/**
 * The game of a campaign (MD): the sport, the two teams, "VS", the start time and the date. All of
 * it comes from the campaign's `event`.
 */
export function CampaignMatch({
  event,
  startsAt,
}: {
  event: CampaignEvent;
  startsAt: string;
}): React.JSX.Element {
  const { sport, away, home } = gameFromEvent(event);
  const SportIcon = SPORT_ICONS[sport];
  return (
    <Card tone="raised" className="px-4 py-6 text-center">
      <p className="flex items-center justify-center gap-2 text-lead uppercase">
        <SportIcon className="size-[18px]" aria-hidden="true" />
        {copy.sports[sport]}
      </p>
      <div
        role="img"
        aria-label={copy.campaigns.versus(away.name, home.name)}
        className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-2"
      >
        <div className="flex min-w-0 flex-col items-center gap-2">
          <TeamBadge abbreviation={away.abbreviation} src={away.art} side="a" size={80} />
          <p className="w-full break-words text-lead leading-tight">{away.name}</p>
          <p className="-mt-1 text-body text-muted">{away.abbreviation}</p>
        </div>
        <span
          aria-hidden="true"
          className="mt-7 grid size-10 place-items-center rounded-full bg-lime text-body text-ink"
        >
          {copy.pickGame.vs}
        </span>
        <div className="flex min-w-0 flex-col items-center gap-2">
          <TeamBadge abbreviation={home.abbreviation} src={home.art} side="b" size={80} />
          <p className="w-full break-words text-lead leading-tight">{home.name}</p>
          <p className="-mt-1 text-body text-muted">{home.abbreviation}</p>
        </div>
      </div>
      <p className="mt-4 text-clock">
        <LocalTime iso={startsAt} style="time" />
      </p>
      <p className="text-body text-muted">
        <LocalTime iso={startsAt} style="date" />
      </p>
    </Card>
  );
}
