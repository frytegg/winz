import type { Sport } from "@winz/shared";

import { pickTeamArt } from "@/lib/team-art";
import { splitEventTitle } from "@/lib/wizard/draft";

export interface FanTeam {
  name: string;
  abbreviation: string;
  /** The sport illustration, or `null` for a round monogram. */
  art: string | null;
}

/** "Texas A&M" → "TEX", "Ole Miss" → "OLE": the first three letters, as on a scoreboard. */
export function abbreviate(name: string): string {
  const latin = name
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  // A name with no Latin letter (東京, Ελλάδα) keeps its own first letters instead of an empty badge.
  return latin !== "" ? latin : [...name.trim()].slice(0, 3).join("").toUpperCase();
}

/**
 * The two teams of a promo, cut out of its `eventTitle` ("Arkansas vs Texas").
 *
 * The public campaign and the ticket carry no teams, no sport and no abbreviation (DEMANDES-ALEXANDRE,
 * item 1), so this is a fallback: the order is the title's, the abbreviation is the first three
 * letters, and the illustration is the football one. It is wrong as soon as the game is not football.
 * `null` when the title has no "vs": the screen then shows the title as one line.
 */
export function teamsFromTitle(
  title: string,
  sport: Sport = "football",
): { away: FanTeam; home: FanTeam } | null {
  const names = splitEventTitle(title);
  if (names === null) return null;
  const [awayName, homeName] = names;
  const away = abbreviate(awayName);
  const home = abbreviate(homeName);
  const art = pickTeamArt(sport, away, home);
  return {
    away: { name: awayName, abbreviation: away, art: art?.away ?? null },
    home: { name: homeName, abbreviation: home, art: art?.home ?? null },
  };
}
