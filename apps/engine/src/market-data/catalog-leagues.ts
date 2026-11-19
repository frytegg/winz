/**
 * The leagues the catalogue reads from Gemini, one listing each (SPEC MD-1).
 *
 * Why one listing per league: Gemini's events listing stops at about 1 000 events whatever the
 * filter (`LISTING_CAP`), and the single Sports listing reached it on 19 Nov 2026 (total 1003):
 * sorted by start time, it held 193 games and not Saturday's. Each league's own listing is far
 * under the cap, and a league whose listing reaches it is logged as an error and treated as
 * incomplete (`loadSportsCatalog`).
 *
 * Each listing is asked with `sport` (Gemini's `sportsMarket.sport`, an exact filter Gemini checks)
 * and `search` (the league's ticker prefix; Gemini's search matches tickers). On 19 Nov 2026,
 * 07:10 to 07:15 UTC, the leagues of each sport added up exactly to that sport's own listing:
 * american_football 982 = NCAAF 633 + NFL 349; basketball 237 = NCAAM 178 + NBA 59; hockey 36 =
 * NHL 36; soccer 102 = UCL 30 + EPL 28 + MLS 24 + LALIGA 11 + LIGAMX 9; baseball 0. Every sync
 * repeats that comparison (one `limit=1` request per sport) and warns when a sport holds events
 * outside the listed leagues: a league that starts listing games (WNBA, college women's
 * basketball...) is then named in the log instead of being silently absent.
 *
 * Adding a league is one line here. Its `sport` must be one Gemini accepts: an unknown one is
 * answered HTTP 400 `invalid sport`, logged as a failed league read every minute.
 */
export interface CatalogLeague {
  /** Ticker prefix ("NCAAF-2611212030-ARK-TEX-M"), sent as `search`; also `events.league`. */
  league: string;
  /** Gemini `sportsMarket.sport`, sent as `sport`. */
  sport: string;
  /** Why it is read, and what it held when it was added. */
  reason: string;
}

export const CATALOG_LEAGUES: readonly CatalogLeague[] = Object.freeze([
  {
    league: "NCAAF",
    sport: "american_football",
    reason:
      "College football, the demo's sport: Saturday's Arkansas at Texas is " +
      "NCAAF-2611212030-ARK-TEX-M. 633 active events on 19 Nov 2026, the largest league, the one " +
      "closest to the cap.",
  },
  {
    league: "NFL",
    sport: "american_football",
    reason: "Pro football. 349 active events on 19 Nov 2026.",
  },
  {
    league: "NCAAM",
    sport: "basketball",
    reason: "Men's college basketball. 178 active events on 19 Nov 2026.",
  },
  {
    league: "NBA",
    sport: "basketball",
    reason: "Pro basketball. 59 active events on 19 Nov 2026.",
  },
  {
    league: "NHL",
    sport: "hockey",
    reason: "Pro hockey. 36 active events on 19 Nov 2026.",
  },
  {
    league: "UCL",
    sport: "soccer",
    reason: "Champions League. 30 active events on 19 Nov 2026, 18 of them full-game moneylines.",
  },
  {
    league: "EPL",
    sport: "soccer",
    reason: "Premier League. 28 active events on 19 Nov 2026.",
  },
  {
    league: "MLS",
    sport: "soccer",
    reason:
      "Major League Soccer. 24 active events on 19 Nov 2026 but no full-game moneyline among " +
      "them (playoff markets): read so its games come in as soon as Gemini lists them.",
  },
  {
    league: "LALIGA",
    sport: "soccer",
    reason: "La Liga. 11 active events on 19 Nov 2026.",
  },
  {
    league: "LIGAMX",
    sport: "soccer",
    reason: "Liga MX. 9 active events on 19 Nov 2026.",
  },
  {
    league: "MLB",
    sport: "baseball",
    reason:
      "Baseball, off-season (0 events on 19 Nov 2026): read so the season's games come in " +
      "without a code change. One request a minute while empty.",
  },
]);
