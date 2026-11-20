import {
  DEFAULT_RISK_PARAMS,
  hedgeInstrumentSchema,
  type ExecutionVenueName,
  type HedgeDeskResponse,
  type HedgeInstrument,
} from "@winz/shared";
import { z } from "zod";

import type { Db } from "./db";
import { serverLogger } from "./logger";
import { digits, isoDate } from "./wire";

/**
 * The public Hedge desk (A-05, SPEC MDB-3): read-only, for the jury, assembled from what the engine
 * writes (`live_hedge_desk`, `engine_pnl`, `engine_params`, `venue_check_runs` and
 * `venue_checks`, `demo_overrides`). The
 * web app computes nothing here: it validates, orders and sums. No personal data, no wallet
 * address: an engine row that would carry one is dropped and logged rather than served.
 */

// ---------------------------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------------------------

export interface VenueDescription {
  /** Shown as-is. */
  label: string;
  /** The known limit of the venue, in one sentence. */
  note: string;
}

const VENUES: Record<ExecutionVenueName, VenueDescription> = {
  paper: {
    label: "PAPER · live Gemini book",
    note:
      "Fills are simulated against the live Gemini order book. Queue position is not simulated, " +
      "so maker fills are optimistic.",
  },
  "gemini-sandbox": {
    label: "GEMINI SANDBOX · test orders",
    note:
      "Orders are real orders on the Gemini sandbox, whose book and fills are test data, not the " +
      "live market.",
  },
  gemini: {
    label: "GEMINI · live orders",
    note: "Orders are placed and filled on the live Gemini exchange, with real money.",
  },
};

/** How the Hedge desk names the execution venue, in clear (SPEC MDB-3). */
export function venueDescription(venue: ExecutionVenueName): VenueDescription {
  return VENUES[venue];
}

// ---------------------------------------------------------------------------------------------
// Personal data guard
// ---------------------------------------------------------------------------------------------

const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;

/** True when the JSON of `value` contains something that looks like an e-mail or a 0x address. */
export function containsPersonalData(value: unknown): boolean {
  const text = JSON.stringify(value);
  return ADDRESS.test(text) || EMAIL.test(text);
}

// ---------------------------------------------------------------------------------------------
// Risk parameters
// ---------------------------------------------------------------------------------------------

/** A JSON number or a string of digits, as the engine reads `engine_params.value`. */
const wholeNumber = z
  .union([z.number().int().nonnegative(), z.string().regex(/^[0-9]+$/, "a string of digits")])
  .transform((value) => BigInt(value));

function boundedInt(min: number, max: number): z.ZodType<number, unknown> {
  return wholeNumber.pipe(z.bigint().min(BigInt(min)).max(BigInt(max))).transform(Number);
}

/**
 * The keys of `engine_params` the desk shows, named as the fields of `DEFAULT_RISK_PARAMS` (the
 * engine's `loadRiskParams` uses the same keys and the same value format). The ranges are the
 * engine's, except that a zero is refused where the public answer requires a positive number.
 */
const PARAM_SCHEMAS = {
  uMaxMicroUsdc: wholeNumber,
  makerTtlSeconds: boundedInt(1, 86_400),
  askMoveTicks: boundedInt(1, 100),
  toleranceTicks: boundedInt(0, 100),
  forceTakerMinutes: boundedInt(1, 10_080),
} as const;

type ParamKey = keyof typeof PARAM_SCHEMAS;

function isParamKey(key: string): key is ParamKey {
  return Object.hasOwn(PARAM_SCHEMAS, key);
}

export interface EngineParamRow {
  key: string;
  value: unknown;
}

/**
 * `DEFAULT_RISK_PARAMS` overridden by the `engine_params` rows. A key the desk does not show is
 * ignored; an invalid value is logged and its default shown.
 */
export function riskParamsOf(rows: readonly EngineParamRow[]): HedgeDeskResponse["params"] {
  let uMax: bigint = DEFAULT_RISK_PARAMS.uMaxMicroUsdc;
  const params = {
    makerTtlSeconds: DEFAULT_RISK_PARAMS.makerTtlSeconds as number,
    askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks as number,
    toleranceTicks: DEFAULT_RISK_PARAMS.toleranceTicks as number,
    forceTakerMinutes: DEFAULT_RISK_PARAMS.forceTakerMinutes as number,
  };
  for (const row of rows) {
    if (!isParamKey(row.key)) continue;
    if (row.key === "uMaxMicroUsdc") {
      const parsed = PARAM_SCHEMAS.uMaxMicroUsdc.safeParse(row.value);
      if (parsed.success) uMax = parsed.data;
      else invalidParam(row.key, parsed.error.issues[0]?.message);
      continue;
    }
    const parsed = PARAM_SCHEMAS[row.key].safeParse(row.value);
    if (parsed.success) params[row.key] = parsed.data;
    else invalidParam(row.key, parsed.error.issues[0]?.message);
  }
  return { uMax: digits(uMax), ...params };
}

function invalidParam(key: string, issue: string | undefined): void {
  serverLogger("hedge-desk").warn(
    { key, issue: issue ?? "invalid" },
    "invalid engine_params value: the default is shown",
  );
}

// ---------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------

export interface DeskRow {
  instrument: string;
  payload: unknown;
}

/**
 * The `live_hedge_desk` payloads that validate against `hedgeInstrumentSchema`, ordered by event
 * start then symbol. A row whose payload does not validate, names another instrument than its key,
 * or carries an e-mail or an address is skipped and logged as an error: never served, never a 500.
 */
export function deskInstruments(rows: readonly DeskRow[]): HedgeInstrument[] {
  const log = serverLogger("hedge-desk");
  const instruments: HedgeInstrument[] = [];
  for (const row of rows) {
    const parsed = hedgeInstrumentSchema.safeParse(row.payload);
    if (!parsed.success) {
      log.error(
        { instrument: row.instrument, issues: parsed.error.issues.slice(0, 5) },
        "live_hedge_desk payload does not match hedgeInstrumentSchema: row skipped",
      );
      continue;
    }
    if (parsed.data.symbol !== row.instrument) {
      log.error(
        { instrument: row.instrument, symbol: parsed.data.symbol },
        "live_hedge_desk payload names another instrument than its row: row skipped",
      );
      continue;
    }
    if (containsPersonalData(parsed.data)) {
      log.error(
        { instrument: row.instrument },
        "live_hedge_desk payload contains an e-mail or an address: row skipped",
      );
      continue;
    }
    instruments.push(parsed.data);
  }
  return instruments.sort((a, b) => {
    const byStart = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    if (byStart !== 0) return byStart;
    if (a.symbol === b.symbol) return 0;
    return a.symbol < b.symbol ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------------------------
// Venue check
// ---------------------------------------------------------------------------------------------

type VenueCheck = NonNullable<HedgeDeskResponse["venueCheck"]>;
type VenueCheckAction = VenueCheck["orders"][number]["action"];

export interface VenueCheckRow {
  venue_order_id: string;
  instrument: string;
  action: VenueCheckAction;
  at: Date;
  side?: "buy" | "sell" | null;
  kind?: "maker" | "taker" | null;
  price_bps?: number | null;
  qty?: bigint | string | null;
  filled_qty?: bigint | string | null;
  status?: string | null;
}

/** A run of the check (`venue_check_runs`, written by the engine's venue:check). */
export interface VenueCheckRunRow {
  id: string;
  venue: string;
  finished_at: Date;
  outcome: "proven" | "failed";
  failed_step: VenueCheck["failedStep"];
  failure: string | null;
}

const ACTION_ORDER: Record<VenueCheckAction, number> = { placed_maker: 0, cancelled: 1, filled: 2 };

const CHECK_VENUES = new Set<string>(["paper", "gemini-sandbox", "gemini"]);

function ordersOf(rows: readonly VenueCheckRow[]): VenueCheck["orders"] {
  return rows
    .map((row) => ({
      venueOrderId: row.venue_order_id,
      instrumentSymbol: row.instrument,
      action: row.action,
      at: isoDate(row.at),
      side: row.side ?? null,
      kind: row.kind ?? null,
      priceBps: row.price_bps ?? null,
      qty: row.qty === null || row.qty === undefined ? null : digits(BigInt(row.qty)),
      filledQty:
        row.filled_qty === null || row.filled_qty === undefined
          ? null
          : digits(BigInt(row.filled_qty)),
      status: row.status ?? null,
    }))
    .filter((order) => {
      if (!containsPersonalData(order)) return true;
      serverLogger("hedge-desk").error(
        { action: order.action },
        "venue_checks row contains an e-mail or an address: left out",
      );
      return false;
    })
    .sort(
      (a, b) =>
        ACTION_ORDER[a.action] - ACTION_ORDER[b.action] ||
        (a.venueOrderId < b.venueOrderId ? -1 : a.venueOrderId > b.venueOrderId ? 1 : 0),
    );
}

/**
 * The latest run of the sandbox order check, with its orders: the latest `venue_check_runs` row
 * (by finish time) and its `venue_checks` rows. A run that failed says at which step and why.
 * Without any run, the rows of `venue_checks` written before runs existed: those sharing the
 * latest `at`, with nulls for what they do not carry. Null when there is neither. Rows carrying an
 * e-mail or an address are left out and logged, and so is a failure reason carrying one.
 */
export function latestVenueCheck(
  run: VenueCheckRunRow | null,
  rows: readonly VenueCheckRow[],
): HedgeDeskResponse["venueCheck"] {
  if (run !== null) {
    let failure = run.failure;
    if (failure !== null && containsPersonalData(failure)) {
      serverLogger("hedge-desk").error(
        "venue_check_runs failure contains an e-mail or an address: left out",
      );
      failure = "(reason withheld)";
    }
    return {
      ranAt: isoDate(run.finished_at),
      venue: CHECK_VENUES.has(run.venue) ? (run.venue as VenueCheck["venue"]) : null,
      outcome: run.outcome,
      failedStep: run.failed_step,
      failure,
      orders: ordersOf(rows),
    };
  }
  const first = rows[0];
  if (first === undefined) return null;
  const ranAt = rows.reduce((latest, row) => (row.at > latest ? row.at : latest), first.at);
  return {
    ranAt: isoDate(ranAt),
    venue: null,
    outcome: null,
    failedStep: null,
    failure: null,
    orders: ordersOf(rows.filter((row) => row.at.getTime() === ranAt.getTime())),
  };
}

async function readVenueCheck(db: Db): Promise<HedgeDeskResponse["venueCheck"]> {
  const [run] = await db<VenueCheckRunRow[]>`
    select id, venue, finished_at, outcome, failed_step, failure from venue_check_runs
    order by finished_at desc, id desc limit 1
  `;
  if (run !== undefined) {
    const rows = await db<VenueCheckRow[]>`
      select venue_order_id, instrument, action, at, side, kind, price_bps, qty, filled_qty, status
      from venue_checks where run_id = ${run.id}
    `;
    return latestVenueCheck(run, rows);
  }
  const rows = await db<VenueCheckRow[]>`
    select venue_order_id, instrument, action, at, side, kind, price_bps, qty, filled_qty, status
    from venue_checks
    where run_id is null and at = (select max(at) from venue_checks where run_id is null)
  `;
  return latestVenueCheck(null, rows);
}

// ---------------------------------------------------------------------------------------------
// GET /api/hedge-desk
// ---------------------------------------------------------------------------------------------

interface TotalsRow {
  maker_savings: bigint;
  guarantee_losses: bigint;
  crossing_gains: bigint;
}

/**
 * GET /api/hedge-desk: every instrument the engine hedges, the venue in clear, the risk
 * parameters, the engine's P&L totals, the latest sandbox order check, and whether demo mode is in
 * use (any `demo_overrides` row).
 */
export async function hedgeDesk(db: Db, venue: ExecutionVenueName): Promise<HedgeDeskResponse> {
  const [deskRows, paramRows, totalsRows, venueCheck, demoRows] = await Promise.all([
    db<DeskRow[]>`select instrument, payload from live_hedge_desk`,
    db<EngineParamRow[]>`select key, value from engine_params`,
    db<TotalsRow[]>`
      select
        coalesce(sum(maker_savings), 0)::bigint as maker_savings,
        coalesce(sum(guarantee_losses), 0)::bigint as guarantee_losses,
        coalesce(sum(crossing_gains), 0)::bigint as crossing_gains
      from engine_pnl
    `,
    readVenueCheck(db),
    db<{ demo: boolean }[]>`select exists (select 1 from demo_overrides) as demo`,
  ]);
  const totals = totalsRows[0];
  if (!totals) throw new Error("engine_pnl totals query returned no row");
  const description = venueDescription(venue);
  return {
    venue,
    venueLabel: description.label,
    venueNote: description.note,
    params: riskParamsOf(paramRows),
    instruments: deskInstruments(deskRows),
    totals: {
      makerSavings: digits(totals.maker_savings),
      guaranteeLosses: digits(totals.guarantee_losses),
      crossingGains: digits(totals.crossing_gains),
    },
    venueCheck,
    demo: demoRows[0]?.demo === true,
  };
}
