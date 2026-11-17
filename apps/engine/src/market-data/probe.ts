/**
 * Manual probe of the real Gemini API: prints the normalized catalogue for a search term.
 *
 *   pnpm --filter @winz/engine exec tsx src/market-data/probe.ts "Texas"
 *
 * Reads only public endpoints, no API key. `GEMINI_API_URL` overrides the base URL.
 */
import { createLogger, moduleLogger } from "../logger";

import { GeminiError, describeError } from "./errors";
import { GeminiRestClient } from "./gemini-rest-client";
import { normalizeCatalog, type NormalizedInstrument } from "./normalize";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function cents(bps: bigint | null): string {
  return bps === null ? "  -" : (Number(bps) / 100).toFixed(0).padStart(3);
}

function instrumentLine(instrument: NormalizedInstrument): string {
  return [
    `    ${instrument.type.padEnd(9)}`,
    instrument.label.padEnd(34),
    `bid ${cents(instrument.bestBidBps)}c`,
    `ask ${cents(instrument.bestAskBps)}c`,
    instrument.symbol,
  ].join("  ");
}

async function main(): Promise<void> {
  const search = process.argv[2];
  if (search === undefined || search.trim() === "") {
    process.stderr.write('usage: tsx src/market-data/probe.ts "<search term>"\n');
    process.exitCode = 2;
    return;
  }

  const logger = moduleLogger(
    createLogger({ level: process.env.APP_LOG_LEVEL ?? "warn", pretty: false }),
    "market-data-probe",
  );
  const client = new GeminiRestClient({
    baseUrl: process.env.GEMINI_API_URL ?? "https://api.gemini.com",
    logger,
  });

  const rawEvents = await client.listAllActiveEvents({ search });
  const catalog = normalizeCatalog(rawEvents);

  out(
    `"${search}": ${rawEvents.length.toString()} raw events -> ${catalog.events.length.toString()} games, ` +
      `${catalog.instruments.length.toString()} instruments, ${catalog.skipped.length.toString()} skipped`,
  );
  for (const event of catalog.events) {
    const instruments = catalog.instruments.filter(
      (instrument) => instrument.eventTicker === event.ticker,
    );
    const quoted = instruments.filter(
      (instrument) => instrument.bestBidBps !== null && instrument.bestAskBps !== null,
    );
    out("");
    out(`${event.ticker}  ${event.title}  [${event.sport}/${event.league}] ${event.status}`);
    out(
      `  starts ${event.startsAt.toISOString()}  sales close ${event.salesCloseAt.toISOString()}` +
        `  home ${event.home.name} (${event.home.abbreviation})  away ${event.away.name} (${event.away.abbreviation})`,
    );
    out(
      `  ${instruments.length.toString()} instruments, ${quoted.length.toString()} quoted on both sides`,
    );
    const moneylines = instruments.filter((instrument) => instrument.type === "moneyline");
    const others = quoted.filter((instrument) => instrument.type !== "moneyline");
    // Unquoted spread and total lines are counted above, not listed: there can be fifty of them.
    const sample = others.length > 0 ? others : instruments.filter((i) => i.type !== "moneyline");
    for (const instrument of [...moneylines, ...sample.slice(0, 6)])
      out(instrumentLine(instrument));
  }

  const reasons = new Map<string, number>();
  for (const item of catalog.skipped) {
    const reason = item.reason.replace(/"[^"]*"/g, '"…"');
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  if (reasons.size > 0) {
    out("");
    out("skipped:");
    for (const [reason, count] of reasons) out(`  ${count.toString().padStart(4)}  ${reason}`);
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof GeminiError ? error.message : describeError(error);
  process.stderr.write(`probe failed: ${detail}\n`);
  process.exitCode = 1;
});
