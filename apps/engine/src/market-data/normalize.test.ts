import { describe, expect, it } from "vitest";

import {
  contractSide,
  leagueFromTicker,
  mapSport,
  moneylineLabel,
  normalizeCatalog,
  salesCloseAt,
  smallestMarginAbove,
  spreadLabel,
  totalLabel,
  type NormalizedInstrument,
} from "./normalize";
import type { RawEvent } from "./schemas";
import { fixtureEvents } from "./test-support";

const ARK_TEX = "NCAAF-2611212030-ARK-TEX-M";
const EDM_FLA = "NHL-2611180000-EDM-FLA-M";
const ARS_NEW = "EPL-2611211730-ARS-NEW-M";

function instrumentsOf(
  instruments: readonly NormalizedInstrument[],
  eventTicker: string,
): NormalizedInstrument[] {
  return instruments.filter((instrument) => instrument.eventTicker === eventTicker);
}

function bySymbol(
  instruments: readonly NormalizedInstrument[],
  symbol: string,
): NormalizedInstrument | undefined {
  return instruments.find((instrument) => instrument.symbol === symbol);
}

/** A minimal game with one spread child, for the cases no recorded payload covers. */
function syntheticGame(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    ticker: "NBA-2701012300-AAA-BBB-M",
    title: "Aaa vs Bbb",
    status: "active",
    category: "Sports",
    startTime: "2027-01-01T23:00:00.000Z",
    gameId: "game-1",
    participants: [
      { name: "Bbb", abbreviation: "BBB", side: "home" },
      { name: "Aaa", abbreviation: "AAA", side: "away" },
    ],
    sportsMarket: { sport: "basketball", type: "moneyline", scope: { type: "full_contest" } },
    contracts: [
      { label: "Bbb", instrumentSymbol: "GEMI-NBA-M-BBB", status: "active", sportsSide: "home" },
      { label: "Aaa", instrumentSymbol: "GEMI-NBA-M-AAA", status: "active", sportsSide: "away" },
    ],
    events: [
      {
        ticker: "NBA-2701012300-AAA-BBB-S",
        title: "Aaa vs Bbb: Point Spread",
        status: "active",
        gameId: "game-1",
        sportsMarket: {
          sport: "basketball",
          type: "spread",
          subject: "team",
          scope: { type: "full_contest" },
          metric: "points",
        },
        contracts: [
          {
            label: "Bbb wins by more than 2.5 points",
            instrumentSymbol: "GEMI-NBA-S-BBB2",
            status: "active",
            strike: { type: "spread", value: "2.5" },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("label rules", () => {
  it("turns a spread strike into the smallest whole margin above it", () => {
    expect(smallestMarginAbove("13.5")).toBe(14);
    expect(smallestMarginAbove("2.5")).toBe(3);
    expect(smallestMarginAbove("0.5")).toBe(1);
    expect(smallestMarginAbove("7")).toBe(8);
    expect(smallestMarginAbove("-3.5")).toBeNull();
    expect(smallestMarginAbove("abc")).toBeNull();
  });

  it("labels spreads as 'Team wins by N+'", () => {
    expect(spreadLabel("Texas wins by more than 13.5 points", "13.5")).toBe("Texas wins by 14+");
    expect(spreadLabel("Florida wins by more than 2.5 goals", "2.5")).toBe("Florida wins by 3+");
    expect(spreadLabel("Texas A&M-CC wins by more than 1.5 points", "1.5")).toBe(
      "Texas A&M-CC wins by 2+",
    );
  });

  it("drops the 'Reg Time:' prefix Gemini puts on soccer spreads", () => {
    expect(spreadLabel("Reg Time: Arsenal wins by more than 1.5 goals", "1.5")).toBe(
      "Arsenal wins by 2+",
    );
  });

  it("returns null for a spread label or strike it does not recognise", () => {
    expect(spreadLabel("Texas covers", "13.5")).toBeNull();
    expect(spreadLabel("Texas wins by more than 13.5 points", "thirteen")).toBeNull();
  });

  it("labels moneylines as 'Team wins' and the tie contract as 'Draw'", () => {
    expect(moneylineLabel({ label: "Texas", sportsSide: "home" })).toBe("Texas wins");
    expect(moneylineLabel({ label: "Tie", sportsSide: "tie" })).toBe("Draw");
  });

  it("labels totals as 'Over N points' or goals", () => {
    expect(totalLabel("45.5", "points")).toBe("Over 45.5 points");
    expect(totalLabel("5.5", "goals")).toBe("Over 5.5 goals");
    expect(totalLabel("45.5", undefined)).toBe("Over 45.5 points");
  });
});

describe("sport, league and sales close", () => {
  it("maps Gemini sports to the shared Sport enum", () => {
    expect(mapSport("american_football")).toBe("football");
    expect(mapSport("basketball")).toBe("basketball");
    expect(mapSport("hockey")).toBe("hockey");
    expect(mapSport("baseball")).toBe("baseball");
    expect(mapSport("soccer")).toBe("soccer");
    expect(mapSport("cricket")).toBe("other");
  });

  it("reads the league from the ticker prefix", () => {
    expect(leagueFromTicker("NCAAF-2611212030-ARK-TEX-M")).toBe("NCAAF");
    expect(leagueFromTicker("MLSCUP26")).toBe("MLSCUP26");
  });

  it("closes sales 5 minutes before the start", () => {
    expect(salesCloseAt(new Date("2026-11-21T20:30:00.000Z")).toISOString()).toBe(
      "2026-11-21T20:25:00.000Z",
    );
  });
});

describe("normalizeCatalog on the recorded active sports page", () => {
  const catalog = normalizeCatalog(fixtureEvents("events-active-sports"));

  it("keeps one event per game: the full-game moneylines only", () => {
    expect(catalog.events.map((event) => event.ticker)).toEqual([ARK_TEX, EDM_FLA, ARS_NEW]);
  });

  it("normalizes the Arkansas vs Texas game", () => {
    expect(catalog.events[0]).toEqual({
      ticker: ARK_TEX,
      title: "Arkansas vs Texas",
      sport: "football",
      league: "NCAAF",
      startsAt: new Date("2026-11-21T20:30:00.000Z"),
      salesCloseAt: new Date("2026-11-21T20:25:00.000Z"),
      home: { name: "Texas Longhorns", abbreviation: "TEX" },
      away: { name: "Arkansas Razorbacks", abbreviation: "ARK" },
      status: "active",
    });
  });

  it("maps hockey and soccer games", () => {
    expect(catalog.events[1]).toMatchObject({ sport: "hockey", league: "NHL" });
    expect(catalog.events[2]).toMatchObject({
      sport: "soccer",
      league: "EPL",
      home: { abbreviation: "NEW" },
      away: { abbreviation: "ARS" },
    });
  });

  it("collects moneyline, full-game spread and total instruments, not first-half markets", () => {
    const instruments = instrumentsOf(catalog.instruments, ARK_TEX);
    const count = (type: string): number =>
      instruments.filter((instrument) => instrument.type === type).length;

    // 2 moneyline + 24 spread (-S) + 19 total (-T); the 23 -1HS and 14 -1HT contracts are out.
    expect(count("moneyline")).toBe(2);
    expect(count("spread")).toBe(24);
    expect(count("total")).toBe(19);
    expect(instruments.some((instrument) => /-1H[ST]-/.test(instrument.symbol))).toBe(false);
  });

  it("builds the moneyline instruments with their best bid and ask", () => {
    expect(bySymbol(catalog.instruments, "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")).toEqual({
      symbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
      eventTicker: ARK_TEX,
      type: "moneyline",
      strike: null,
      label: "Texas wins",
      side: "home",
      bestBidBps: 9000n,
      bestAskBps: 9200n,
    });
    expect(bySymbol(catalog.instruments, "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK")).toMatchObject({
      label: "Arkansas wins",
      bestBidBps: 800n,
      bestAskBps: 1000n,
    });
  });

  it("builds a spread instrument: 13.5 becomes '14+', prices null on an empty book", () => {
    expect(bySymbol(catalog.instruments, "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13")).toEqual({
      symbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13",
      eventTicker: ARK_TEX,
      type: "spread",
      strike: "13.5",
      label: "Texas wins by 14+",
      // No `sportsSide` on this recorded contract: read from the "TEX13" end of the symbol.
      side: "home",
      bestBidBps: null,
      bestAskBps: null,
    });
  });

  it("builds total instruments from Gemini's over-only contracts", () => {
    // Recorded label: "More than 67.5 points scored", strike { type: "over", value: "67.5" }.
    expect(bySymbol(catalog.instruments, "GEMI-NCAAF-2611212030-ARK-TEX-T-O67")).toEqual({
      symbol: "GEMI-NCAAF-2611212030-ARK-TEX-T-O67",
      eventTicker: ARK_TEX,
      type: "total",
      strike: "67.5",
      label: "Over 67.5 points",
      side: null,
      bestBidBps: null,
      bestAskBps: null,
    });
  });

  it("uses goals for hockey: 2.5 becomes '3+'", () => {
    expect(bySymbol(catalog.instruments, "GEMI-NHL-2611180000-EDM-FLA-S-FLA2")).toEqual({
      symbol: "GEMI-NHL-2611180000-EDM-FLA-S-FLA2",
      eventTicker: EDM_FLA,
      type: "spread",
      strike: "2.5",
      label: "Florida wins by 3+",
      side: "home",
      bestBidBps: 1800n,
      bestAskBps: 2200n,
    });
    expect(bySymbol(catalog.instruments, "GEMI-NHL-2611180000-EDM-FLA-T-O5")).toMatchObject({
      type: "total",
      strike: "5.5",
      label: "Over 5.5 goals",
      bestBidBps: 5500n,
      bestAskBps: 5700n,
    });
  });

  it("handles a three-way soccer moneyline and its regulation-time markets", () => {
    const labels = instrumentsOf(catalog.instruments, ARS_NEW)
      .filter((instrument) => instrument.type === "moneyline")
      .map((instrument) => instrument.label);
    expect(labels).toEqual(["Arsenal wins", "Draw", "Newcastle wins"]);

    const spreads = instrumentsOf(catalog.instruments, ARS_NEW).filter(
      (instrument) => instrument.type === "spread",
    );
    expect(spreads.map((instrument) => instrument.label)).toEqual([
      "Arsenal wins by 2+",
      "Arsenal wins by 3+",
      "Newcastle wins by 2+",
      "Newcastle wins by 3+",
    ]);
    expect(
      instrumentsOf(catalog.instruments, ARS_NEW).filter((i) => i.type === "total"),
    ).toHaveLength(6);
  });

  it("dedupes a child market that also appears at top level", () => {
    const symbols = catalog.instruments.map((instrument) => instrument.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(
      symbols.filter((symbol) => symbol === "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13"),
    ).toHaveLength(1);
  });

  it("does not treat a first-quarter moneyline as a game", () => {
    expect(catalog.events.some((event) => event.ticker.endsWith("-1QM"))).toBe(false);
    expect(catalog.instruments.some((instrument) => instrument.symbol.includes("-1QM-"))).toBe(
      false,
    );
  });

  it("skips an event without startTime or participants and says why", () => {
    expect(catalog.skipped).toEqual([
      {
        ref: "WNBA27DRAFTENESKANTER",
        reason: "not a game: no startTime or no participants",
      },
    ]);
  });
});

describe("normalizeCatalog edge cases", () => {
  it("attaches a top-level spread to its game through gameId, as in search results", () => {
    const [game, ...rest] = fixtureEvents("events-active-sports");
    expect(game?.ticker).toBe(ARK_TEX);
    // Search results list children at top level too; here the game arrives without its `events`.
    const flat: RawEvent[] = [{ ...(game as RawEvent), events: [] }, ...rest];
    const catalog = normalizeCatalog(flat);

    const instruments = instrumentsOf(catalog.instruments, ARK_TEX);
    expect(instruments.filter((instrument) => instrument.type === "spread")).toHaveLength(24);
    // The -T market is not in this payload at all.
    expect(instruments.filter((instrument) => instrument.type === "total")).toHaveLength(0);
  });

  it("reports a spread market whose game is not in the payload", () => {
    const orphan = fixtureEvents("events-active-sports").filter(
      (event) => event.ticker === "NCAAF-2611212030-ARK-TEX-S",
    );
    const catalog = normalizeCatalog(orphan);
    expect(catalog.events).toEqual([]);
    expect(catalog.instruments).toEqual([]);
    expect(catalog.skipped).toEqual([
      { ref: "NCAAF-2611212030-ARK-TEX-S", reason: "no full-game moneyline for this market" },
    ]);
  });

  it("skips a game without startTime instead of throwing", () => {
    const catalog = normalizeCatalog([syntheticGame({ startTime: undefined })]);
    expect(catalog.events).toEqual([]);
    expect(catalog.instruments).toEqual([]);
    expect(catalog.skipped).toEqual([
      { ref: "NBA-2701012300-AAA-BBB-M", reason: "game without startTime" },
    ]);
  });

  it("skips a game without participants instead of throwing", () => {
    for (const participants of [
      undefined,
      [],
      [{ name: "Bbb", abbreviation: "BBB", side: "home" }],
    ]) {
      const catalog = normalizeCatalog([syntheticGame({ participants })]);
      expect(catalog.events).toEqual([]);
      expect(catalog.skipped).toEqual([
        {
          ref: "NBA-2701012300-AAA-BBB-M",
          reason: "game without a home and an away participant",
        },
      ]);
    }
  });

  it("leaves out combos, settled contracts and markets that are not trading yet", () => {
    const game = syntheticGame();
    game.contracts.push(
      { label: "Combo", instrumentSymbol: "GEMI-CMB", status: "active", isCombo: true },
      { label: "Old", instrumentSymbol: "GEMI-OLD", status: "settled", resolutionSide: "no" },
    );
    const child = game.events?.[0];
    if (child) child.status = "approved";

    const catalog = normalizeCatalog([game]);
    expect(catalog.instruments.map((instrument) => instrument.symbol)).toEqual([
      "GEMI-NBA-M-BBB",
      "GEMI-NBA-M-AAA",
    ]);
    expect(catalog.skipped).toEqual([
      { ref: "GEMI-CMB", reason: "combo contract" },
      { ref: "GEMI-OLD", reason: 'contract status is "settled"' },
      { ref: "NBA-2701012300-AAA-BBB-S", reason: 'market status is "approved"' },
    ]);
  });

  it("leaves out team totals, props and period markets", () => {
    const game = syntheticGame();
    const base = game.events?.[0];
    if (!base) throw new Error("synthetic game has no child");
    const variant = (
      suffix: string,
      sportsMarket: NonNullable<RawEvent["sportsMarket"]>,
    ): NonNullable<RawEvent["events"]>[number] => ({
      ...base,
      ticker: `NBA-2701012300-AAA-BBB-${suffix}`,
      sportsMarket,
      contracts: [
        {
          label: "More than 99.5 points scored",
          instrumentSymbol: `GEMI-NBA-${suffix}-X`,
          status: "active",
          strike: { type: "over", value: "99.5" },
        },
      ],
    });
    game.events = [
      variant("TT", {
        sport: "basketball",
        type: "total",
        subject: "team",
        scope: { type: "full_contest" },
      }),
      variant("PPPTS", {
        sport: "basketball",
        type: "prop",
        subject: "player",
        scope: { type: "full_contest" },
      }),
      variant("1HT", {
        sport: "basketball",
        type: "total",
        subject: "contest",
        scope: { type: "half" },
      }),
      variant("T", {
        sport: "basketball",
        type: "total",
        subject: "contest",
        scope: { type: "full_contest" },
        metric: "points",
      }),
    ];

    const catalog = normalizeCatalog([game]);
    expect(catalog.instruments.filter((instrument) => instrument.type !== "moneyline")).toEqual([
      {
        symbol: "GEMI-NBA-T-X",
        eventTicker: "NBA-2701012300-AAA-BBB-M",
        type: "total",
        strike: "99.5",
        label: "Over 99.5 points",
        side: null,
        bestBidBps: null,
        bestAskBps: null,
      },
    ]);
  });

  it("skips a spread contract whose label it cannot read, keeps the others", () => {
    const game = syntheticGame();
    game.events?.[0]?.contracts.push({
      label: "Bbb covers 4.5",
      instrumentSymbol: "GEMI-NBA-S-BBB4",
      status: "active",
      strike: { type: "spread", value: "4.5" },
    });
    const catalog = normalizeCatalog([game]);
    expect(bySymbol(catalog.instruments, "GEMI-NBA-S-BBB2")?.label).toBe("Bbb wins by 3+");
    expect(bySymbol(catalog.instruments, "GEMI-NBA-S-BBB4")).toBeUndefined();
    expect(catalog.skipped).toEqual([
      { ref: "GEMI-NBA-S-BBB4", reason: 'unrecognised spread label "Bbb covers 4.5"' },
    ]);
  });

  it("keeps one side of the book when only that side is quoted", () => {
    const game = syntheticGame();
    const contract = game.contracts[0];
    if (contract) contract.prices = { bestAsk: "0.02" };
    const catalog = normalizeCatalog([game]);
    expect(bySymbol(catalog.instruments, "GEMI-NBA-M-BBB")).toMatchObject({
      bestBidBps: null,
      bestAskBps: 200n,
    });
  });
});

describe("contract side", () => {
  const teams = { home: "TEX", away: "ARK" };

  it("takes Gemini's sportsSide on moneylines, the draw included", () => {
    const catalog = normalizeCatalog(fixtureEvents("events-active-sports"));
    const sides = instrumentsOf(catalog.instruments, ARS_NEW)
      .filter((instrument) => instrument.type === "moneyline")
      .map((instrument) => [instrument.label, instrument.side]);
    // As recorded: Gemini lists Newcastle as the home participant of "Arsenal vs Newcastle".
    expect(sides).toEqual([
      ["Arsenal wins", "away"],
      ["Draw", "tie"],
      ["Newcastle wins", "home"],
    ]);
    expect(bySymbol(catalog.instruments, "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK")?.side).toBe("away");
  });

  it("reads the side of a spread from its symbol when sportsSide is absent", () => {
    expect(
      contractSide({ instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13" }, "spread", teams),
    ).toBe("home");
    expect(
      contractSide({ instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-ARK3" }, "spread", teams),
    ).toBe("away");
  });

  it("agrees with sportsSide on every recorded spread that carries one", () => {
    const events = fixtureEvents("events-active-sports");
    let compared = 0;
    for (const game of events) {
      const home = game.participants?.find((participant) => participant.side === "home");
      const away = game.participants?.find((participant) => participant.side === "away");
      if (!home || !away) continue;
      for (const market of game.events ?? []) {
        if (market.sportsMarket?.type !== "spread") continue;
        for (const contract of market.contracts) {
          if (!contract.sportsSide) continue;
          const fromSymbol = contractSide(
            { instrumentSymbol: contract.instrumentSymbol },
            "spread",
            { home: home.abbreviation, away: away.abbreviation },
          );
          expect(fromSymbol).toBe(contract.sportsSide);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(10);
  });

  it("gives every recorded moneyline and spread a side, and no total", () => {
    const catalog = normalizeCatalog(fixtureEvents("events-active-sports"));
    for (const instrument of catalog.instruments) {
      if (instrument.type === "total") expect(instrument.side).toBeNull();
      else expect(instrument.side).not.toBeNull();
    }
  });

  it("prefers sportsSide over the symbol", () => {
    expect(
      contractSide({ instrumentSymbol: "GEMI-X-S-TEX13", sportsSide: "away" }, "spread", teams),
    ).toBe("away");
  });

  it("is null when nothing tells: unknown sportsSide, unknown abbreviation, a moneyline without sportsSide", () => {
    expect(
      contractSide({ instrumentSymbol: "GEMI-X-S-OU13", sportsSide: "neutral" }, "spread", teams),
    ).toBeNull();
    expect(contractSide({ instrumentSymbol: "GEMI-X-S-13" }, "spread", teams)).toBeNull();
    expect(contractSide({ instrumentSymbol: "GEMI-X-M-TEX" }, "moneyline", teams)).toBeNull();
    expect(
      contractSide({ instrumentSymbol: "GEMI-X-S-AAA2" }, "spread", { home: "AAA", away: "AAA" }),
    ).toBeNull();
  });

  it("is always null on totals", () => {
    expect(
      contractSide({ instrumentSymbol: "GEMI-X-T-O45", sportsSide: "home" }, "total", teams),
    ).toBeNull();
  });
});
