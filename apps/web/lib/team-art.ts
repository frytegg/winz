import type { Sport } from "@winz/shared";

/**
 * Teams rarely come with a logo (`logoUrl` is usually null) and we never use an official one
 * (MASTER section 6). Each team gets a sport illustration chosen from its abbreviation, so the
 * same team always has the same art, and the two teams of a game never share one.
 */
const ART: Partial<Record<Sport, readonly string[]>> = {
  football: [38, 39, 40, 41, 42].map((n) => `/sports/football-${n.toString()}.png`),
  basketball: [43, 44, 45, 46].map((n) => `/sports/basketball-${n.toString()}.png`),
  soccer: [47, 48, 49, 50].map((n) => `/sports/soccer-${n.toString()}.png`),
};

function hash(text: string): number {
  let value = 0;
  for (const char of text.toUpperCase()) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

/** The illustrations of a game's two teams, or `null` for a sport without art (monogram instead). */
export function pickTeamArt(
  sport: Sport,
  awayAbbreviation: string,
  homeAbbreviation: string,
): { away: string; home: string } | null {
  const pool = ART[sport];
  if (pool === undefined || pool.length === 0) return null;
  const awayIndex = hash(awayAbbreviation) % pool.length;
  let homeIndex = hash(homeAbbreviation) % pool.length;
  if (homeIndex === awayIndex) homeIndex = (homeIndex + 1) % pool.length;
  const away = pool[awayIndex];
  const home = pool[homeIndex];
  if (away === undefined || home === undefined) return null;
  return { away, home };
}

/** One team alone (a ticket, a list row): the same pick as in a game, so the art stays stable. */
export function pickSingleTeamArt(sport: Sport, abbreviation: string): string | null {
  const pool = ART[sport];
  if (pool === undefined || pool.length === 0) return null;
  return pool[hash(abbreviation) % pool.length] ?? null;
}
