import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { formatMicro, formatWei } from "./estimate";
import {
  SecretLeakError,
  type InvariantResult,
  type LagStats,
  type OddsReaderRecord,
  type OddsRecord,
  type RehearsalReceipt,
  type RpcRecord,
  type Stats,
} from "./types";

/**
 * The receipt of a run: a JSON file and a Markdown file named by the UTC start time, the chain id
 * and the outcome. Neither may contain a key, the seed or an e-mail address: `assertNoSecrets`
 * is checked on both texts before anything is written.
 */

export function stats(values: readonly number[]): Stats {
  if (values.length === 0) return { count: 0, minMs: null, medianMs: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
  return {
    count: sorted.length,
    minMs: sorted[0] ?? null,
    medianMs: median,
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

/** The receipt as JSON: bigints as decimal strings, the written paths left out. */
export function receiptJson(receipt: RehearsalReceipt): string {
  const { files: _files, ...written } = receipt;
  return `${JSON.stringify(
    written,
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  )}\n`;
}

/**
 * Throws `SecretLeakError` when `text` contains one of `secrets` (case-insensitive, with or
 * without its 0x prefix) or anything shaped like an e-mail address. The error never quotes it.
 */
export function assertNoSecrets(text: string, secrets: readonly string[], where: string): void {
  const lower = text.toLowerCase();
  for (const secret of secrets) {
    const value = secret.toLowerCase();
    if (value.length < 16) continue;
    const bare = value.startsWith("0x") ? value.slice(2) : value;
    if (lower.includes(value) || lower.includes(bare)) throw new SecretLeakError(where);
  }
  if (new RegExp(EMAIL.source, "i").test(text))
    throw new SecretLeakError(`${where} (e-mail address)`);
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Shorter values are not treated as secrets (an RPC path such as "v2" is not one). */
const MIN_REDACTED_LENGTH = 8;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` with every one of `secrets` (case-insensitive, with or without its 0x prefix) replaced by
 * `<redacted>` and every e-mail address by `<e-mail>`. Applied to every line the rehearsal prints
 * and to every free text of the receipt: an engine warning can quote an RPC URL whose path is an
 * access token (viem puts the URL in its error messages).
 */
export function redactText(text: string, secrets: readonly string[]): string {
  let redacted = text;
  const values = new Set<string>();
  for (const secret of secrets) {
    if (secret.length < MIN_REDACTED_LENGTH) continue;
    values.add(secret);
    if (/^0x/i.test(secret) && secret.length - 2 >= MIN_REDACTED_LENGTH)
      values.add(secret.slice(2));
  }
  // Longest first, so that a secret containing another is replaced whole.
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(value), "gi"), "<redacted>");
  }
  return redacted.replace(EMAIL, "<e-mail>");
}

/** "20261118T203012Z": the start time, UTC, to the second. */
export function compactUtc(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

export function receiptBaseName(receipt: RehearsalReceipt): string {
  const outcome = receipt.scenario?.outcome ?? "none";
  return `${compactUtc(receipt.startedAt)}-${receipt.chain.chainId.toString()}-${outcome}`;
}

function ms(value: number | null): string {
  return value === null ? "–" : `${value.toString()} ms`;
}

function statsRow(name: string, value: Stats): string {
  return `| ${name} | ${value.count.toString()} | ${ms(value.minMs)} | ${ms(value.medianMs)} | ${ms(value.maxMs)} |`;
}

function lagRow(path: string, from: string, reader: OddsReaderRecord, lag: LagStats): string {
  return `| ${path} | ${reader.source} | ${from} | ${lag.count.toString()} | ${reader.failed.toString()} | ${ms(lag.minMs)} | ${ms(lag.medianMs)} | ${ms(lag.p95Ms)} | ${ms(lag.maxMs)} |`;
}

/** The section "Ticket odds": both paths, what they are judged from, and what they leave out. */
export function oddsMarkdown(odds: OddsRecord | null): string[] {
  const lines: string[] = ["## Ticket odds", ""];
  if (odds === null) {
    lines.push("Not measured: the run stopped before the engine started.");
    return lines;
  }
  lines.push(
    `How late the odds a ticket shows are on the book they come from (criterion 7: under 2 s). Engine settings: a book is written at most once per ${ms(odds.writeThrottleMs)} per instrument (\`writeThrottleMs\`), demo books are read every ${ms(odds.demoRefreshMs)} (\`demoRefreshMs\`). Each source read every ${odds.pollMs.toString()} ms; a driven price not readable within ${odds.sampleTimeoutMs.toString()} ms is a failed sample. The live_instruments row was ${odds.rowAccess}.`,
  );
  lines.push("");
  const rows: string[] = [];
  if (odds.driven.measured) {
    for (const reader of odds.driven.readers) {
      rows.push(lagRow("driven", "call returned", reader, reader.lag));
      if (reader.lagFromSent !== null) {
        rows.push(lagRow("driven", "call sent", reader, reader.lagFromSent));
      }
    }
  }
  if (odds.live.measured) {
    for (const reader of odds.live.readers) {
      rows.push(lagRow("live", "observed_at", reader, reader.lag));
    }
  }
  if (rows.length > 0) {
    lines.push("| Path | Read at | From | Samples | Failed | Min | Median | p95 | Max |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    lines.push(...rows);
    lines.push("");
  }
  const driven = odds.driven;
  lines.push(
    driven.measured
      ? `Driven book (\`${driven.instrument ?? "–"}\`): ${driven.samples.length.toString()} prices, mids ${driven.samples.map((sample) => sample.midBps.toString()).join(", ")} bps; the call that set the book took ${lagText(driven.samples.map((sample) => sample.callMs))}.`
      : `Driven book: not measured (${driven.note ?? "–"}).`,
  );
  const live = odds.live;
  lines.push(
    live.measured
      ? `Live feed (\`${live.instrument ?? "–"}\`, watched ${(live.windowMs / 1_000).toString()} s before the book was driven): ${live.lagsMs.length.toString()} updates seen.`
      : `Live feed: not measured (${live.note ?? "–"}).`,
  );
  for (const reader of [...driven.readers, ...live.readers]) {
    if (reader.readErrors > 0) {
      lines.push(
        `${reader.source}: ${reader.readErrors.toString()} reads answered an error (read again at the next poll); last: ${reader.lastError ?? "–"}.`,
      );
    }
  }
  lines.push("");
  lines.push(odds.judgedFrom);
  lines.push("");
  lines.push(odds.observedAt);
  lines.push("");
  lines.push(odds.measurementError);
  lines.push("");
  lines.push(odds.excludes);
  return lines;
}

function lagText(values: readonly number[]): string {
  if (values.length === 0) return "–";
  const sorted = [...values].sort((a, b) => a - b);
  return `${(sorted[0] ?? 0).toString()} to ${(sorted[sorted.length - 1] ?? 0).toString()} ms`;
}

/** PASSED, FAILED, or NOT MEASURED (never passed). */
export function verdictOf(invariant: InvariantResult): string {
  if (invariant.measured === false) return "NOT MEASURED";
  return invariant.passed ? "PASSED" : "FAILED";
}

function hashCell(hash: string, url: string | null): string {
  return url === null ? `\`${hash}\`` : `[\`${hash}\`](${url})`;
}

/** The Markdown record: facts a reader can check against the explorer, no adjectives. */
export function receiptMarkdown(receipt: RehearsalReceipt): string {
  const lines: string[] = [];
  const status = receipt.status.toUpperCase();
  const outcome = receipt.scenario?.outcome.toUpperCase() ?? "–";
  lines.push(`# Rehearsal ${compactUtc(receipt.startedAt)}: ${status}`);
  lines.push("");
  lines.push(
    `Chain ${receipt.chain.chainId.toString()} (${receipt.chain.name}${receipt.chain.local ? ", local" : ""}), RPC host \`${receipt.chain.rpcHost}\`. Escrow \`${receipt.escrow.address}\` (deployed at block ${receipt.escrow.deployBlock.toString()}). Started ${receipt.startedAt}, finished ${receipt.finishedAt}. Outcome asked: ${outcome}. Gemini: ${receipt.gemini}.`,
  );
  lines.push("");
  lines.push(
    `Run start block ${receipt.escrow.runStartBlock?.toString() ?? "–"}; the engine read the escrow's events from block ${receipt.escrow.engineStartBlock?.toString() ?? "–"} on an empty database.`,
  );
  lines.push("");
  lines.push(
    `Engine: ${receipt.engine.started ? "started" : "not started"}, ${receipt.engine.stopped ? "stopped before the receipt was written" : "not stopped cleanly"}. Run id \`${receipt.runId}\`.`,
  );
  if (receipt.failure !== null) {
    lines.push("");
    lines.push(`**FAILED at step \`${receipt.failure.step}\`**: ${receipt.failure.reason}`);
  }
  lines.push("");
  lines.push("## Roles");
  lines.push("");
  lines.push("| Role | Address |");
  lines.push("|---|---|");
  lines.push(`| Relayer | \`${receipt.roles.relayer}\` |`);
  lines.push(`| Oracle | \`${receipt.roles.oracle}\` |`);
  lines.push(`| Treasury | \`${receipt.roles.treasury ?? "–"}\` |`);
  lines.push(`| Merchant (demo wallet) | \`${receipt.roles.merchant ?? "–"}\` |`);
  for (const buyer of receipt.roles.buyers) {
    lines.push(`| Buyer ${buyer.number.toString()} (demo wallet) | \`${buyer.address}\` |`);
  }

  lines.push("");
  lines.push("## Game, campaign, scenario");
  lines.push("");
  if (receipt.game !== null) {
    lines.push(
      `Game \`${receipt.game.ticker}\` (${receipt.game.title}), starts ${receipt.game.startsAt}.`,
    );
  }
  if (receipt.instrument !== null) {
    lines.push(
      `Instrument \`${receipt.instrument.symbol}\` (${receipt.instrument.conditionLabel}), pause threshold ${receipt.instrument.pauseThresholdBps.toString()} bps.`,
    );
  }
  if (receipt.campaign !== null) {
    lines.push(
      `Campaign \`${receipt.campaign.id}\`, on-chain id ${receipt.campaign.onchainId.toString()}, slug \`${receipt.campaign.slug}\`.`,
    );
  }
  if (receipt.driven !== null) {
    lines.push(
      `Driven book: bid ${receipt.driven.bidBps.toString()} bps, ask ${receipt.driven.askBps.toString()} bps, depth ${receipt.driven.depth.toString()} micro-contracts.`,
    );
  }
  const scenario = receipt.scenario;
  if (scenario !== null) {
    lines.push(
      `Scenario: ${scenario.purchases.toString()} sales of ${scenario.unitsPerPurchase.toString()} unit(s) at ${formatMicro(scenario.unitPrice)} USDC, refund ${scenario.refundBps.toString()} bps, margins ${scenario.usualMarginBps.toString()}/${scenario.minMarginBps.toString()} bps, budget ${formatMicro(scenario.budget)} USDC, ${scenario.buyers.toString()} buyers, ${scenario.parallel.toString()} sales at a time, outcome ${scenario.outcome}.`,
    );
  }

  const probe = receipt.pauseProbe;
  if (probe !== null) {
    lines.push(
      probe.skipped === null
        ? `Pause probe before the sales: book driven to bid ${probe.bidBps.toString()} / ask ${probe.askBps.toString()} bps; the campaign page answered ${probe.saleState ?? "open throughout"}; the demo sale route ${probe.saleRefusal === null ? "accepted a sale" : `answered ${probe.saleRefusal}`}.`
        : `Pause probe skipped: ${probe.skipped}.`,
    );
  }

  if (receipt.estimate !== null) {
    const estimate = receipt.estimate;
    lines.push("");
    lines.push("## Estimate before the run");
    lines.push("");
    lines.push(
      `Fee per gas ${formatWei(estimate.feePerGasWei, 9)} gwei. Treasury fronts at worst ${formatMicro(estimate.treasuryLocks)} USDC. Gas at worst: relayer ${estimate.relayerGas.toString()}, oracle ${estimate.oracleGas.toString()}, sweep ${estimate.sweepGas.toString()}. Treasury needs ${formatWei(estimate.treasuryNeedsWithMargin, 18)} USDC with the 20 % margin.`,
    );
  }

  lines.push("");
  lines.push("## Transactions");
  lines.push("");
  if (receipt.transactions.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Kind | Signer | Status | Block | Gas used | Fee (wei) | Hash |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const tx of receipt.transactions) {
      lines.push(
        `| ${tx.kind}${tx.ownCampaign ? "" : " (other campaign)"} | ${tx.signer} | ${tx.status} | ${tx.block?.toString() ?? "–"} | ${tx.gasUsed?.toString() ?? "–"} | ${tx.feeWei?.toString() ?? "–"} | ${hashCell(tx.hash, tx.explorerUrl)} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Timings");
  lines.push("");
  lines.push("| Measure | Count | Min | Median | Max |");
  lines.push("|---|---|---|---|---|");
  lines.push(statsRow("Demo sale call → ticket issued", receipt.timings.callToTicket));
  lines.push(
    statsRow("Demo sale call → sale on the merchant's detail", receipt.timings.callToDashboard),
  );
  const refunds = receipt.timings.refunds;
  if (refunds !== null) {
    lines.push("");
    lines.push(
      `Refunds: settle mined in block ${refunds.settleBlock.toString()}, last refund in block ${refunds.lastRefundBlock.toString()} (${refunds.blocks.toString()} blocks, ${refunds.chainSeconds === null ? "–" : refunds.chainSeconds.toString()} s of chain time, ${refunds.wallMs === null ? "–" : `${refunds.wallMs.toString()} ms`} of wall clock between the rehearsal first seeing the block of settle and the block of the last refund, each block watched every 500 ms). ${refunds.batches.length.toString()} batch(es):`,
    );
    for (const batch of refunds.batches) {
      lines.push(
        `- ${batch.tickets.toString()} tickets, gas ${batch.gasUsed?.toString() ?? "–"}, broadcast ${batch.sentAt ?? "–"}, block time ${batch.blockTime ?? "–"}, \`${batch.hash}\``,
      );
    }
  }
  lines.push("");
  lines.push("Steps:");
  lines.push("");
  for (const step of receipt.steps) {
    lines.push(`- ${step.step}: ${step.status}, ${ms(step.durationMs)}`);
  }
  // Receipts written before the measure have no `odds` at all: no section.
  if (receipt.odds !== undefined) {
    lines.push("");
    lines.push(...oddsMarkdown(receipt.odds));
  }

  if (receipt.hedging !== null) {
    const hedging = receipt.hedging;
    lines.push("");
    lines.push("## Hedging");
    lines.push("");
    lines.push(
      `${hedging.orders.toString()} orders (${hedging.makerOrders.toString()} maker, ${hedging.takerOrders.toString()} taker), ${hedging.fills.toString()} fills, ${hedging.makersFilledByTheRehearsal.toString()} makers filled by moving the driven book. ${hedging.charges.toString()} tickets charged, ${formatMicro(hedging.hedgeSpent)} USDC spent. Maker savings ${formatMicro(hedging.makerSavings)} USDC, guarantee losses over the run ${formatMicro(hedging.guaranteeLossesDelta)} USDC. At close: held ${hedging.heldAtClose?.toString() ?? "–"}, exposure ${hedging.exposureAtClose?.toString() ?? "–"} micro-contracts.`,
    );
  }

  lines.push("");
  lines.push("## Invariants");
  lines.push("");
  if (receipt.invariants.length === 0) lines.push("Not checked.");
  for (const invariant of receipt.invariants) {
    lines.push(`- ${verdictOf(invariant)}: ${invariant.name}. ${invariant.details}`);
  }

  lines.push("");
  lines.push("## Balances (USDC, 18 decimals)");
  lines.push("");
  lines.push("| Account | Address | Before | After settlement | After sweep |");
  lines.push("|---|---|---|---|---|");
  const find = (rows: RehearsalReceipt["balances"]["before"], role: string): string => {
    const row = rows.find((item) => item.role === role);
    return row === undefined ? "–" : formatWei(row.moneyWei, 18);
  };
  for (const row of receipt.balances.before) {
    lines.push(
      `| ${row.role} | \`${row.address}\` | ${formatWei(row.moneyWei, 18)} | ${find(receipt.balances.afterSettlement, row.role)} | ${find(receipt.balances.afterSweep, row.role)} |`,
    );
  }
  lines.push("");
  lines.push(
    `Net cost of the run for the treasury and the oracle, sweep included: ${receipt.netCostWei === null ? "–" : `${formatWei(receipt.netCostWei, 18)} USDC`}. Gas paid: ${formatWei(receipt.gasWei, 18)} ${receipt.chain.moneyMode === "native-usdc" ? "USDC" : "native coin (not USDC)"}.`,
  );

  lines.push("");
  lines.push("## Sweep");
  lines.push("");
  if (receipt.sweep.length === 0) lines.push("Nothing swept.");
  for (const row of receipt.sweep) {
    lines.push(
      `- ${row.wallet} \`${row.address}\`: ${row.status}, ${formatWei(row.sentWei, 18)} USDC back${row.txHash === null ? "" : `, \`${row.txHash}\``}`,
    );
  }
  if (receipt.recovery !== null) {
    const recovery = receipt.recovery;
    lines.push("");
    lines.push("## Recovery after the failure");
    lines.push("");
    lines.push(
      `Sales closed and result ${recovery.outcome.toUpperCase()} forced so that the escrow settles and releases: ${recovery.released ? "released" : `not released (${recovery.reason ?? "unknown"})`}.`,
    );
  }
  if (receipt.rpc !== null) {
    lines.push("");
    lines.push("## Node");
    lines.push("");
    lines.push(describeRpc(receipt.rpc));
    lines.push("");
    lines.push("| Step | Requests | Duration | Per second |");
    lines.push("|---|---|---|---|");
    for (const row of receipt.rpc.perStep) {
      const perSecond =
        row.durationMs > 0 ? ((row.requests * 1_000) / row.durationMs).toFixed(2) : "–";
      lines.push(
        `| ${row.step} | ${row.requests.toString()} | ${row.durationMs.toString()} ms | ${perSecond} |`,
      );
    }
  }
  if (receipt.leftBehind.length > 0) {
    lines.push("");
    lines.push("## Left behind");
    lines.push("");
    for (const line of receipt.leftBehind) lines.push(`- ${line}`);
  }
  if (receipt.unread.length > 0) {
    lines.push("");
    lines.push("## Could not be read");
    lines.push("");
    for (const line of receipt.unread) lines.push(`- ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** One sentence: the runner's requests, refusals and retries, and the shared limiter's counts. */
export function describeRpc(rpc: RpcRecord): string {
  const limiter =
    rpc.limiter === null
      ? "no limiter"
      : `the limiter shared with the engine let ${rpc.limiter.started.toString()} requests through, saw ${rpc.limiter.rateLimited.toString()} rate-limit answers and cooled down ${rpc.limiter.coolDowns.toString()} times`;
  return `${rpc.requests.toString()} requests by the runner's own client, ${rpc.refused.toString()} refused (${rpc.rateLimited.toString()} rate limits), ${rpc.retried.toString()} reads retried; ${limiter}.`;
}

/**
 * Writes `<base>.json` and `<base>.md` into `dir` (created when missing), never over an existing
 * receipt. Both texts are redacted (`redactText`) before they are checked: a secret that slipped
 * into a free text is replaced rather than costing the run its receipt. `assertNoSecrets` is the
 * last check, and still refuses to write a text that redaction did not clean. Returns the paths.
 */
export async function writeReceipt(
  receipt: RehearsalReceipt,
  dir: string,
  secrets: readonly string[],
): Promise<{ json: string; markdown: string }> {
  return writeTexts(
    dir,
    receiptBaseName(receipt),
    receiptJson(receipt),
    receiptMarkdown(receipt),
    secrets,
  );
}

/**
 * Writes `<base>.json` and `<base>.md` into `dir` (`<base>-2` and so on when taken), redacted,
 * then checked by `assertNoSecrets`; never over an existing file. Returns the paths.
 */
export async function writeTexts(
  dir: string,
  base: string,
  jsonText: string,
  markdownText: string,
  secrets: readonly string[],
): Promise<{ json: string; markdown: string }> {
  const json = redactText(jsonText, secrets);
  const markdown = redactText(markdownText, secrets);
  assertNoSecrets(json, secrets, "the JSON receipt");
  assertNoSecrets(markdown, secrets, "the Markdown receipt");
  await mkdir(dir, { recursive: true });
  let name = base;
  for (let copy = 2; existsSync(join(dir, `${name}.json`)); copy += 1) {
    name = `${base}-${copy.toString()}`;
  }
  const paths = { json: join(dir, `${name}.json`), markdown: join(dir, `${name}.md`) };
  await writeFile(paths.json, json, { flag: "wx" });
  await writeFile(paths.markdown, markdown, { flag: "wx" });
  return paths;
}
