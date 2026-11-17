// Shared helpers for the hidden behaviour tests. Self-contained on purpose:
// it must not depend on anything under the repo's own tests/ directory.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HttpClient, HttpRequest, HttpResponse } from '../../src/index.js';

type Handler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export class FakeHttp implements HttpClient {
  readonly requests: HttpRequest[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly routes: Array<{ match: string; handler: Handler }> = [];

  constructor(private readonly latencyMs = 0) {}

  on(match: string, response: HttpResponse | Handler): this {
    this.routes.push({ match, handler: typeof response === 'function' ? response : () => response });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
      }
      const route = this.routes.find((r) => req.url.includes(r.match));
      if (!route) return { status: 400, body: { code: -1121, msg: 'Invalid symbol.' } };
      return await route.handler(req);
    } finally {
      this.inFlight--;
    }
  }
}

export function binanceTicker(symbol: string, last: number, changePct = 0): HttpResponse {
  return {
    status: 200,
    body: {
      symbol,
      lastPrice: String(last),
      bidPrice: String(last),
      askPrice: String(last),
      priceChangePercent: String(changePct),
      closeTime: 1_788_000_000_000,
    },
  };
}

export function fakeBinance(prices: Record<string, number | [number, number]>, latencyMs = 0): FakeHttp {
  const http = new FakeHttp(latencyMs);
  for (const [symbol, spec] of Object.entries(prices)) {
    const [last, change] = Array.isArray(spec) ? spec : [spec, 0];
    http.on(`symbol=${symbol}`, binanceTicker(symbol, last, change));
  }
  return http;
}

export const noSleep = async (): Promise<void> => {};

/** 2026-09-01T12:00:00.000Z */
export const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);

export function captureIO(extra: Partial<{ http: HttpClient; now: () => number; sleep: (ms: number) => Promise<void> }> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdoutText: () => out.join('\n'),
    io: {
      stdout: (text: string) => {
        out.push(text);
      },
      stderr: (text: string) => {
        err.push(text);
      },
      now: () => NOW,
      sleep: noSleep,
      ...extra,
    },
  };
}

const tempDirs: string[] = [];

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pw-hidden-'));
  tempDirs.push(dir);
  return dir;
}

export async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

/** Removes temp dirs after giving any in-flight background writes time to land. */
export async function cleanupTempDirs(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

/** A two-asset portfolio whose numbers are exact in binary floating point. */
export const SIMPLE_HOLDINGS = [
  { asset: 'BTC', quantity: 2, avgCost: 50000 },
  { asset: 'ETH', quantity: 10, avgCost: 3500 },
];

export const SIMPLE_PRICES = { BTCUSDT: 60000, ETHUSDT: 3000 };
