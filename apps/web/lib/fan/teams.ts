import type { CampaignEvent, Sport, Team } from "@winz/shared";

import { pickTeamArt } from "@/lib/team-art";

export interface FanTeam {
  name: string;
  abbreviation: string;
  /** The team's own logo when the API has one, else the sport illustration, else `null` (monogram). */
  art: string | null;
}

export interface FanGame {
  sport: Sport;
  /** Shown on the left, as in the title ("Arkansas vs Texas"). */
  away: FanTeam;
  home: FanTeam;
}

function fanTeam(team: Team, art: string | null): FanTeam {
  return { name: team.name, abbreviation: team.abbreviation, art: team.logoUrl ?? art };
}

/**
 * The two teams of a promo, as the API gives them (`event` on the public campaign, the ticket and
 * the merchant's list and detail): their names, abbreviations, the sport and the illustration that
 * goes with it.
 */
export function gameFromEvent(event: CampaignEvent): FanGame {
  const art = pickTeamArt(event.sport, event.away.abbreviation, event.home.abbreviation);
  return {
    sport: event.sport,
    away: fanTeam(event.away, art?.away ?? null),
    home: fanTeam(event.home, art?.home ?? null),
  };
}
