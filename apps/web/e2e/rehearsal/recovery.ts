import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

import { REFUND_BATCH_SIZE, type Outcome } from "@winz/shared";

import { escrowHolds, stageOf, type CampaignEvents, type OnchainCampaignState } from "./chain";
import { GAS_UNITS, WEI_PER_MICRO, formatMicro, formatWei, withMargin } from "./estimate";
import { describeRpc, writeTexts } from "./receipt";
import type {
  CampaignStateRecord,
  GeminiMode,
  MoneyMode,
  RecoveryEstimate,
  RecoveryReceipt,
  RecoveryResult,
  RecoveryResultSource,
  Scenario,
} from "./types";

/**
 * The pure parts of `--recover`: reading the receipt a recovery starts from (version 1, as the
 * first Arc run wrote it, or 2), the campaign's state, what is left to send, and the recovery's
 * own receipt. The orchestration, which reuses the run's steps, is `recoverRehearsal` in runner.ts.
 */

/** The receipt cannot be used to recover a campaign. Lists every reason at once. */
export class RecoveryReceiptError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(reasons.join("\n"));
    this.name = "RecoveryReceiptError";
  }
}

const bigintText = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((value) => BigInt(value));

const addressText = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "not an address")
  .transform((value) => getAddress(value));

const receiptSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  runId: z.string().regex(/^[0-9a-f]{12}$/),
  status: z.enum(["passed", "failed", "estimate"]),
  failure: z.object({ step: z.string(), reason: z.string() }).nullable(),
  startedAt: z.string(),
  chain: z.object({
    chainId: z.number().int().positive(),
    local: z.boolean(),
    moneyMode: z.enum(["native-usdc", "erc20"]).nullable(),
    token: addressText.nullable(),
  }),
  escrow: z.object({
    address: addressText,
    deployBlock: bigintText,
    runStartBlock: bigintText.nullable(),
    engineStartBlock: bigintText.nullable().optional(),
  }),
  roles: z.object({
    relayer: addressText,
    oracle: addressText,
    treasury: addressText.nullable(),
    merchant: addressText.nullable(),
    buyers: z.array(z.object({ number: z.number().int().positive(), address: addressText })),
  }),
  gemini: z.enum(["live", "simulated"]),
  instrument: z.object({ symbol: z.string().min(1) }).nullable(),
  campaign: z
    .object({
      id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      onchainId: bigintText,
      slug: z.string().min(1),
    })
    .nullable(),
  scenario: z
    .object({
      purchases: z.number().int(),
      unitsPerPurchase: z.number().int(),
      unitPrice: bigintText,
      refundBps: z.number().int(),
      usualMarginBps: z.number().int(),
      minMarginBps: z.number().int(),
      budget: bigintText,
      outcome: z.enum(["yes", "no"]),
      buyers: z.number().int(),
      parallel: z.number().int(),
    })
    .nullable(),
  driven: z
    .object({ bidBps: z.number().int(), askBps: z.number().int(), depth: bigintText })
    .nullable(),
  // Read only to say whether the run forced a result; a receipt without them is still accepted.
  steps: z.array(z.object({ step: z.string(), status: z.string() })).optional(),
  recovery: z.unknown().optional(),
});

/**
 * What the run's receipt shows of a result the run itself forced through the demo route. Its
 * `settle` step forces the scenario's result before it waits for the settlement; its own
 * `recover` step, once it has decided the result, forces NO when none was forced or known. The
 * run's reset then clears every forced result, settled or not.
 * - `forced`: the `settle` step is recorded done, so its force went through.
 * - `maybe`: a step that forces a result is recorded (`settle` failed; the run's own recovery
 *   with its `recovery` record, written once it had decided), but not whether the force went
 *   through.
 * - `none`: the receipt lists its steps and none of them forced a result.
 * - `unknown`: the receipt lists no steps.
 */
export type RunForcedResult =
  | { kind: "forced" }
  | { kind: "maybe"; steps: ("settle" | "recover")[] }
  | { kind: "none"; failedAt: string | null }
  | { kind: "unknown" };

/** What a run's receipt shows of a result the run forced, from its steps and its recovery. Pure. */
export function runForcedResult(receipt: {
  steps: readonly { step: string; status: string }[] | null;
  /** The receipt holds the record its own recovery writes once it has decided the result. */
  recoveryDecided: boolean;
  failedAt: string | null;
}): RunForcedResult {
  const steps = receipt.steps;
  if (steps === null) return { kind: "unknown" };
  if (steps.some((item) => item.step === "settle" && item.status === "done")) {
    return { kind: "forced" };
  }
  const maybe: ("settle" | "recover")[] = [];
  if (steps.some((item) => item.step === "settle")) maybe.push("settle");
  if (receipt.recoveryDecided && steps.some((item) => item.step === "recover")) {
    maybe.push("recover");
  }
  if (maybe.length > 0) return { kind: "maybe", steps: maybe };
  return { kind: "none", failedAt: receipt.failedAt };
}

/** What a recovery takes from the receipt of the run it finishes. */
export interface RunReceiptFacts {
  /** The receipt's path, as given. */
  file: string;
  version: 1 | 2;
  runId: string;
  status: "passed" | "failed" | "estimate";
  failure: { step: string; reason: string } | null;
  startedAt: string;
  chainId: number;
  local: boolean;
  moneyMode: MoneyMode | null;
  escrow: {
    address: Address;
    deployBlock: bigint;
    runStartBlock: bigint | null;
    engineStartBlock: bigint | null;
  };
  roles: {
    relayer: Address;
    oracle: Address;
    treasury: Address | null;
    merchant: Address;
    buyers: { number: number; address: Address }[];
  };
  gemini: GeminiMode["kind"];
  campaign: { id: string; onchainId: bigint; slug: string };
  instrument: string;
  scenario: Scenario;
  driven: { bidBps: number; askBps: number; depth: bigint } | null;
  /** What the receipt shows of a result the run itself forced. */
  runForced: RunForcedResult;
}

/** Parses a receipt's JSON text. Throws `RecoveryReceiptError` listing every problem. */
export function parseRunReceipt(text: string, file: string): RunReceiptFacts {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RecoveryReceiptError([`${basename(file)} is not JSON`]);
  }
  const parsed = receiptSchema.safeParse(json);
  if (!parsed.success) {
    throw new RecoveryReceiptError(
      parsed.error.issues.map(
        (issue) => `${basename(file)}: ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const receipt = parsed.data;
  const problems: string[] = [];
  if (receipt.status === "estimate") {
    problems.push(`${basename(file)} is the receipt of an estimate: nothing was sent`);
  }
  if (receipt.campaign === null) {
    problems.push(
      `${basename(file)} names no campaign: the run stopped before creating one, nothing is in the escrow`,
    );
  }
  if (receipt.roles.merchant === null) problems.push(`${basename(file)} names no merchant wallet`);
  if (receipt.instrument === null) problems.push(`${basename(file)} names no instrument`);
  if (receipt.scenario === null) problems.push(`${basename(file)} names no scenario`);
  if (
    problems.length > 0 ||
    receipt.campaign === null ||
    receipt.roles.merchant === null ||
    receipt.instrument === null ||
    receipt.scenario === null
  ) {
    throw new RecoveryReceiptError(problems);
  }
  return {
    file,
    version: receipt.version,
    runId: receipt.runId,
    status: receipt.status,
    failure: receipt.failure,
    startedAt: receipt.startedAt,
    chainId: receipt.chain.chainId,
    local: receipt.chain.local,
    moneyMode: receipt.chain.moneyMode,
    escrow: {
      address: receipt.escrow.address,
      deployBlock: receipt.escrow.deployBlock,
      runStartBlock: receipt.escrow.runStartBlock,
      engineStartBlock: receipt.escrow.engineStartBlock ?? null,
    },
    roles: {
      relayer: receipt.roles.relayer,
      oracle: receipt.roles.oracle,
      treasury: receipt.roles.treasury,
      merchant: receipt.roles.merchant,
      buyers: [...receipt.roles.buyers].sort((a, b) => a.number - b.number),
    },
    gemini: receipt.gemini,
    campaign: receipt.campaign,
    instrument: receipt.instrument.symbol,
    scenario: receipt.scenario,
    driven: receipt.driven,
    runForced: runForcedResult({
      steps: receipt.steps ?? null,
      recoveryDecided: receipt.recovery !== undefined && receipt.recovery !== null,
      failedAt: receipt.failure?.step ?? null,
    }),
  };
}

/** Reads and parses the receipt at `path`. */
export function readRunReceipt(path: string): RunReceiptFacts {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new RecoveryReceiptError([`the receipt ${path} cannot be read`]);
  }
  return parseRunReceipt(text, path);
}

/** The campaign's state, from the escrow, its events and the block they were read at. Pure. */
export function campaignState(
  onchain: OnchainCampaignState,
  events: CampaignEvents,
  block: bigint,
  blockTimestamp: bigint,
): CampaignStateRecord {
  return {
    stage: stageOf(onchain, blockTimestamp),
    block,
    blockTimestamp,
    salesClose: onchain.salesClose,
    released: onchain.released,
    ticketsSold: events.purchased.length,
    ticketsCharged: new Set(events.charged.map((charge) => charge.ticketId)).size,
    hedgeCharges: events.charged.length,
    ticketsRefunded: new Set(events.refunded.map((refund) => refund.ticketId)).size,
    hedgeBudget: onchain.hedgeBudget,
    hedgeSpent: onchain.hedgeSpent,
    hedgeReserved: onchain.hedgeReserved,
    lockedRefunds: onchain.lockedRefunds,
    merchantDue: onchain.merchantDue,
    escrowHolds: escrowHolds(onchain),
  };
}

/** One sentence saying where the campaign stands. */
export function describeState(state: CampaignStateRecord): string {
  const holds =
    state.escrowHolds === 0n
      ? "the escrow holds nothing for it"
      : `the escrow holds ${formatMicro(state.escrowHolds)} USDC for it (unspent budget ${formatMicro(state.released ? 0n : state.hedgeBudget - state.hedgeSpent)}, locked refunds ${formatMicro(state.lockedRefunds)}, merchant's due ${formatMicro(state.merchantDue)})`;
  return `${state.stage} at block ${state.block.toString()}: ${state.ticketsSold.toString()} ticket(s) sold, ${state.ticketsCharged.toString()} charged, ${state.ticketsRefunded.toString()} refunded; ${holds}`;
}

export interface RecoveryEstimateInput {
  state: CampaignStateRecord;
  /** The result already forced or known; null when the recovery will force NO. */
  decided: Outcome | null;
  /** Refundable amounts of the tickets sold, and of those not refunded yet (micro-USDC). */
  refundableSold: bigint;
  unrefundedTickets: number;
  nodeMaxFeePerGasWei: bigint;
  moneyMode: MoneyMode;
}

/**
 * What a recovery still sends, at worst, and what it needs: the oracle charges each ticket not
 * charged and settles; the relayer closes sales if they are open, on YES refunds each ticket not
 * refunded and pays the merchant (whose due the treasury pays), releases, and may replace one
 * transaction. Nothing once the campaign is released. Pure.
 */
export function estimateRecovery(input: RecoveryEstimateInput): RecoveryEstimate {
  const { state } = input;
  const fee = input.nodeMaxFeePerGasWei;
  if (state.released) {
    return {
      feePerGasWei: fee,
      treasuryPays: 0n,
      relayerGas: 0n,
      oracleGas: 0n,
      treasuryNeedsWithMargin: 0n,
      relayerGasNeedsWithMarginWei: 0n,
      oracleNeedsWithMarginWei: 0n,
    };
  }
  const settled =
    state.stage === "settled yes" || state.stage === "settled no" || state.stage === "void";
  const open = state.stage === "selling" || state.stage === "paused";
  const yes = state.stage === "settled yes" || (!settled && input.decided === "yes");
  const uncharged = BigInt(Math.max(0, state.ticketsSold - state.ticketsCharged));
  const unrefunded = BigInt(Math.max(0, input.unrefundedTickets));
  const batches = (unrefunded + BigInt(REFUND_BATCH_SIZE) - 1n) / BigInt(REFUND_BATCH_SIZE);
  const oracleGas = GAS_UNITS.chargeHedgePerTicket * uncharged + (settled ? 0n : GAS_UNITS.settle);
  const paysMerchant = yes && (!settled || state.merchantDue > 0n);
  const relayerGas =
    (open ? GAS_UNITS.closeSales : 0n) +
    (yes ? GAS_UNITS.refundBatchBase * batches + GAS_UNITS.refundPerTicket * unrefunded : 0n) +
    (paysMerchant ? GAS_UNITS.payMerchant : 0n) +
    GAS_UNITS.release +
    // One transaction the sender may have to replace.
    GAS_UNITS.buyFor;
  const treasuryPays = !yes ? 0n : settled ? state.merchantDue : input.refundableSold;
  const relayerGasWei = relayerGas * fee;
  const oracleGasWei = oracleGas * fee;
  const treasuryNeeds =
    treasuryPays * WEI_PER_MICRO + (input.moneyMode === "native-usdc" ? relayerGasWei : 0n);
  return {
    feePerGasWei: fee,
    treasuryPays,
    relayerGas,
    oracleGas,
    treasuryNeedsWithMargin: withMargin(treasuryNeeds),
    relayerGasNeedsWithMarginWei: withMargin(relayerGasWei),
    oracleNeedsWithMarginWei: withMargin(oracleGasWei),
  };
}

/** The escrow's `Outcome` enum, as `CampaignSettled` carries it. */
const ONCHAIN_OUTCOMES: readonly (Outcome | "void")[] = ["yes", "no", "void"];

/** The result `CampaignSettled` names (0 YES, 1 NO, 2 VOID); null for any other value. */
export function settledOutcome(onchain: number): Outcome | "void" | null {
  return ONCHAIN_OUTCOMES[onchain] ?? null;
}

const FORCING_STEPS: Record<"settle" | "recover", string> = {
  settle: "its settle step, which forces the scenario's result before it waits for the settlement",
  recover:
    "its own recovery past the point where it decides the result (it then forces NO when nothing is decided)",
};

/**
 * What the run's receipt says of a result the run forced: the run's own reset (which clears
 * every forced result) is named as a possible cause only when the receipt shows the run forced
 * one, and as a conditional one when the receipt cannot show it.
 */
function whatTheRunForced(runForced: RunForcedResult): string {
  switch (runForced.kind) {
    case "forced":
      return "the run had forced its own result (its receipt records its settle step done), and the run's reset clears every forced result, which may be why none was left";
    case "maybe":
      return `the run's receipt records ${runForced.steps.map((step) => FORCING_STEPS[step]).join(", and ")}, but cannot show whether a result was forced there; if one was, the run's reset, which clears every forced result, would explain why none was left`;
    case "none":
      return `the run never forced a result (its receipt records ${runForced.failedAt === null ? "no settle step" : `a failure at ${runForced.failedAt}, before any settle step`}, and no recovery of its own that got as far as deciding one)`;
    case "unknown":
      return "the run's receipt lists no steps, so it cannot show whether the run had forced a result, nor what cleared one";
  }
}

function why(
  source: RecoveryResultSource | null,
  settled: string,
  runForced: RunForcedResult,
): string {
  switch (source) {
    case "forced by this recovery":
      return `no result was forced or known in the database when this recovery started, so the recovery forced NO; ${whatTheRunForced(runForced)}; the money comes back all the same, through the merchant's wallet and the sweep`;
    case "already forced in the database":
      return `the result ${settled} was already forced in the database when this recovery started, and the recovery kept it`;
    case "known in the database":
      return `the instrument's result was already known in the database as ${settled}`;
    case "already settled on-chain":
      return "the campaign was already settled on-chain when this recovery started";
    case null:
      return "the recovery did not decide it";
  }
}

/**
 * The result a recovery settled the campaign with (`settled`: the outcome of its
 * `CampaignSettled` event, null when it is not settled), where it came from, and one sentence
 * when it is not the outcome the run's scenario asked for. When the recovery forced NO itself,
 * the sentence says what the run's receipt shows of a result the run had forced (`runForced`),
 * and no more. Pure.
 */
export function recoveryResult(input: {
  settled: number | null;
  source: RecoveryResultSource | null;
  scenarioOutcome: Outcome;
  runId: string;
  runForced: RunForcedResult;
}): RecoveryResult {
  const settledWith = input.settled === null ? null : settledOutcome(input.settled);
  const differs =
    settledWith === null || settledWith === input.scenarioOutcome
      ? null
      : `The campaign was settled ${settledWith.toUpperCase()}, not ${input.scenarioOutcome.toUpperCase()} as the scenario of run ${input.runId} asked: ${why(input.source, settledWith.toUpperCase(), input.runForced)}.`;
  return {
    settledWith,
    source: input.source,
    scenarioOutcome: input.scenarioOutcome,
    differs,
  };
}

/** The lines of a recovery's result, for its Markdown. */
export function resultLines(result: RecoveryResult | null | undefined): string[] {
  if (result === null || result === undefined) return [];
  const settled =
    result.settledWith === null
      ? "not settled"
      : `${result.settledWith.toUpperCase()} (${result.source ?? "source unknown"})`;
  const lines = [
    `Settled with: ${settled}; the run's scenario asked for ${result.scenarioOutcome.toUpperCase()}.`,
  ];
  if (result.differs !== null) lines.push("", result.differs);
  return lines;
}

/** The recovery receipt's base name: the run's, with `-recovery`. */
export function recoveryBaseName(runReceiptPath: string): string {
  return `${basename(runReceiptPath).replace(/\.json$/i, "")}-recovery`;
}

/** The recovery receipt as JSON: bigints as decimal strings, the written paths left out. */
export function recoveryJson(receipt: RecoveryReceipt): string {
  const { files: _files, ...written } = receipt;
  return `${JSON.stringify(
    written,
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  )}\n`;
}

function stateLines(title: string, state: CampaignStateRecord | null): string[] {
  return [`${title}: ${state === null ? "could not be read" : describeState(state)}.`];
}

/** The Markdown record of a recovery. */
export function recoveryMarkdown(receipt: RecoveryReceipt): string {
  const lines: string[] = [];
  lines.push(
    `# Recovery of the rehearsal ${receipt.recovers.runId}: ${receipt.status.toUpperCase()}`,
  );
  lines.push("");
  lines.push(
    `Recovers \`${basename(receipt.recovers.file)}\` (run \`${receipt.recovers.runId}\`, started ${receipt.recovers.startedAt}, ${receipt.recovers.status.toUpperCase()}${receipt.recovers.failure === null ? "" : ` at step \`${receipt.recovers.failure.step}\`: ${receipt.recovers.failure.reason}`}). That receipt is not rewritten.`,
  );
  lines.push("");
  lines.push(
    `Chain ${receipt.chain.chainId.toString()} (${receipt.chain.name}), RPC host \`${receipt.chain.rpcHost}\`. Escrow \`${receipt.escrow.address}\`. Campaign \`${receipt.campaign.id}\`, on-chain id ${receipt.campaign.onchainId.toString()}, instrument \`${receipt.campaign.instrument}\`. Gemini: ${receipt.gemini}. Started ${receipt.startedAt}, finished ${receipt.finishedAt}.`,
  );
  lines.push("");
  lines.push(
    `Engine: ${receipt.engine.started ? "started" : "not started"}${receipt.engine.started ? (receipt.engine.stopped ? ", stopped before the receipt was written" : ", not stopped cleanly") : ""}.`,
  );
  if (receipt.failure !== null) {
    lines.push("");
    lines.push(`**FAILED at step \`${receipt.failure.step}\`**: ${receipt.failure.reason}`);
  }
  lines.push("");
  lines.push("## The campaign");
  lines.push("");
  lines.push(...stateLines("Before", receipt.stateBefore));
  lines.push("");
  lines.push(...stateLines("After", receipt.stateAfter));
  lines.push("");
  lines.push(
    `Result waited for: ${receipt.outcome === null ? "–" : receipt.outcome.toUpperCase()}.`,
  );
  const result = resultLines(receipt.result);
  if (result.length > 0) lines.push("", ...result);
  if (receipt.estimate !== null) {
    const estimate = receipt.estimate;
    lines.push("");
    lines.push(
      `Left to send at worst, before anything was sent: relayer ${estimate.relayerGas.toString()} gas, oracle ${estimate.oracleGas.toString()} gas at ${formatWei(estimate.feePerGasWei, 9)} gwei; the treasury pays ${formatMicro(estimate.treasuryPays)} USDC.`,
    );
  }
  lines.push("");
  lines.push("## What the recovery did");
  lines.push("");
  if (receipt.actions.length === 0) lines.push("Nothing.");
  for (const action of receipt.actions) lines.push(`- ${action}`);
  lines.push("");
  lines.push("Steps:");
  lines.push("");
  for (const step of receipt.steps) {
    lines.push(
      `- ${step.step}: ${step.status}, ${step.durationMs === null ? "–" : `${step.durationMs.toString()} ms`}`,
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
      const hash =
        tx.explorerUrl === null ? `\`${tx.hash}\`` : `[\`${tx.hash}\`](${tx.explorerUrl})`;
      lines.push(
        `| ${tx.kind}${tx.ownCampaign ? "" : " (other campaign)"} | ${tx.signer} | ${tx.status} | ${tx.block?.toString() ?? "–"} | ${tx.gasUsed?.toString() ?? "–"} | ${tx.feeWei?.toString() ?? "–"} | ${hash} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Balances (USDC, 18 decimals)");
  lines.push("");
  lines.push("| Account | Address | Before | After |");
  lines.push("|---|---|---|---|");
  for (const row of receipt.balances.before) {
    const after = receipt.balances.after.find((item) => item.address === row.address);
    lines.push(
      `| ${row.role} | \`${row.address}\` | ${formatWei(row.moneyWei, 18)} | ${after === undefined ? "–" : formatWei(after.moneyWei, 18)} |`,
    );
  }
  lines.push("");
  lines.push("## Sweep");
  lines.push("");
  if (receipt.sweep.length === 0) lines.push("Nothing swept.");
  for (const row of receipt.sweep) {
    lines.push(
      `- ${row.wallet} \`${row.address}\`: ${row.status}, ${formatWei(row.sentWei, 18)} USDC back${row.txHash === null ? "" : `, \`${row.txHash}\``}`,
    );
  }
  if (receipt.rpc !== null) {
    lines.push("");
    lines.push("## Node");
    lines.push("");
    lines.push(describeRpc(receipt.rpc));
  }
  lines.push("");
  lines.push("## Left behind");
  lines.push("");
  if (receipt.leftBehind.length === 0) lines.push("Nothing.");
  for (const line of receipt.leftBehind) lines.push(`- ${line}`);
  if (receipt.unread.length > 0) {
    lines.push("");
    lines.push("## Could not be read");
    lines.push("");
    for (const line of receipt.unread) lines.push(`- ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Writes `<run receipt>-recovery.json` and `.md` next to the run's receipt (`-recovery-2` and so
 * on when one exists already), redacted and checked for secrets. Never touches the run's receipt.
 */
export async function writeRecoveryReceipt(
  receipt: RecoveryReceipt,
  runReceiptPath: string,
  secrets: readonly string[],
): Promise<{ json: string; markdown: string }> {
  return writeTexts(
    dirname(runReceiptPath),
    recoveryBaseName(runReceiptPath),
    recoveryJson(receipt),
    recoveryMarkdown(receipt),
    secrets,
  );
}
