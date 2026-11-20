import pino, { type Logger } from "pino";

import { GeminiPrivateClient, type GeminiPrivateClientOptions } from "./client";
import {
  startSimGemini,
  type SimContract,
  type SimGemini,
  type SimServerOptions,
} from "./sim-server";

/**
 * Made-up credentials of the simulated server, never a real key, kept low-entropy on purpose so a
 * secret scanner does not take them for one.
 */
export const SIM_KEY = "account-sim-not-a-real-key";
export const SIM_SECRET = "sim-secret-not-a-real-key";

/** A crypto contract like the sandbox's (20 Nov 2026): bid 0.38, ask 0.57, two-sided. */
export function cryptoContract(overrides: Partial<SimContract> = {}): SimContract {
  return {
    instrumentSymbol: "GEMI-BTC2611202200-HI91000",
    eventTitle: "BTC price today at 5pm EST",
    expiryDate: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    bids: [
      { price: "0.38", amount: "5.0" },
      { price: "0.37", amount: "12.0" },
    ],
    asks: [
      { price: "0.57", amount: "3.0" },
      { price: "0.58", amount: "10.0" },
    ],
    ...overrides,
  };
}

export async function simGemini(overrides: Partial<SimServerOptions> = {}): Promise<SimGemini> {
  return startSimGemini({
    apiKey: SIM_KEY,
    apiSecret: SIM_SECRET,
    contracts: [cryptoContract()],
    ...overrides,
  });
}

/** A client of the simulated server, without the production pauses. */
export function simClient(
  sim: SimGemini,
  logger: Logger,
  overrides: Partial<GeminiPrivateClientOptions> = {},
): GeminiPrivateClient {
  return new GeminiPrivateClient({
    baseUrl: sim.baseUrl,
    apiKey: SIM_KEY,
    apiSecret: SIM_SECRET,
    logger,
    minIntervalMs: 0,
    rateLimitBaseDelayMs: 5,
    rateLimitMaxDelayMs: 20,
    timeoutMs: 2_000,
    ...overrides,
  });
}

/** A logger at the most verbose level whose lines are kept, to search them afterwards. */
export function capturedLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = pino({ level: "trace" }, { write: (line: string) => lines.push(line) });
  return { logger, lines };
}

export const noSleep = (): Promise<void> => Promise.resolve();
