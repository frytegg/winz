import { copy } from "@/lib/copy";
import { teamsFromTitle } from "@/lib/fan/teams";
import { sportFromSymbol } from "@/lib/merchant/campaigns";

import { Card } from "../ui/card";
import { LocalTime } from "../ui/local-time";
import { SPORT_ICONS } from "../ui/sport-icons";

import { TeamBadge } from "./team-badge";

/**
 * The game of a campaign (MD): the sport, the two teams, "VS", the start time and the date. The
 * campaign has no teams or sport (DEMANDES-ALEXANDRE, item 1): the teams are cut out of the title and
 * the sport is read from the league of the symbol, football when unknown.
 */
export function CampaignMatch({
  eventTitle,
  instrumentSymbol,
  startsAt,
}: {
  eventTitle: string;
  instrumentSymbol: string;
  startsAt: string;
}): React.JSX.Element {
  const sport = sportFromSymbol(instrumentSymbol);
  const teams = teamsFromTitle(eventTitle, sport);
  const SportIcon = SPORT_ICONS[sport];
  return (
    <Card tone="raised" className="px-4 py-6 text-center">
      <p className="flex items-center justify-center gap-2 text-lead uppercase">
        <SportIcon className="size-[18px]" aria-hidden="true" />
        {copy.sports[sport]}
      </p>
      {teams === null ? (
        <p className="mt-5 text-title">{eventTitle}</p>
      ) : (
        <div
          role="img"
          aria-label={copy.campaigns.versus(teams.away.name, teams.home.name)}
          className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-2"
        >
          <div className="flex min-w-0 flex-col items-center gap-2">
            <TeamBadge
              abbreviation={teams.away.abbreviation}
              src={teams.away.art}
              side="a"
              size={80}
            />
            <p className="w-full break-words text-lead leading-tight">{teams.away.name}</p>
            <p className="-mt-1 text-body text-muted">{teams.away.abbreviation}</p>
          </div>
          <span
            aria-hidden="true"
            className="mt-7 grid size-10 place-items-center rounded-full bg-lime text-body text-ink"
          >
            {copy.pickGame.vs}
          </span>
          <div className="flex min-w-0 flex-col items-center gap-2">
            <TeamBadge
              abbreviation={teams.home.abbreviation}
              src={teams.home.art}
              side="b"
              size={80}
            />
            <p className="w-full break-words text-lead leading-tight">{teams.home.name}</p>
            <p className="-mt-1 text-body text-muted">{teams.home.abbreviation}</p>
          </div>
        </div>
      )}
      <p className="mt-4 text-clock">
        <LocalTime iso={startsAt} style="time" />
      </p>
      <p className="text-body text-muted">
        <LocalTime iso={startsAt} style="date" />
      </p>
    </Card>
  );
}
