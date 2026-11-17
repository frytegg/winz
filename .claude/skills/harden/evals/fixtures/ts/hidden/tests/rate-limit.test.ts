// Trap X08: getTickers is sequential on purpose (per-IP weight limits); the
// limiter must space calls and requests must never overlap.
import { describe, expect, it } from 'vitest';
import { createExchange } from '../../src/index.js';
import { fakeBinance } from './_support.js';

function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe('ticker fetching respects the rate limit', () => {
  it('never has two requests in flight', async () => {
    const http = fakeBinance({ BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150, ADAUSDT: 0.5, XRPUSDT: 0.6 }, 5);
    const c = clock();
    const exchange = createExchange('binance', { http, now: c.now, sleep: c.sleep, minIntervalMs: 250 });

    const tickers = await exchange.getTickers(['BTC', 'ETH', 'SOL', 'ADA', 'XRP'], 'USDT');

    expect(tickers.size).toBe(5);
    expect(http.maxInFlight).toBe(1);
  });

  it('requests in input order, spaced by the minimum interval', async () => {
    const http = fakeBinance({ BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150, ADAUSDT: 0.5 });
    const c = clock();
    const exchange = createExchange('binance', { http, now: c.now, sleep: c.sleep, minIntervalMs: 250 });

    await exchange.getTickers(['BTC', 'ETH', 'SOL', 'ADA'], 'USDT');

    expect(http.requests.map((r) => new URL(r.url).searchParams.get('symbol'))).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'ADAUSDT',
    ]);
    expect(c.sleeps).toHaveLength(3);
    for (const ms of c.sleeps) expect(ms).toBeGreaterThanOrEqual(250);
  });

  it('keeps going after one asset fails', async () => {
    const http = fakeBinance({ BTCUSDT: 60000, SOLUSDT: 150 });
    const c = clock();
    const exchange = createExchange('binance', { http, now: c.now, sleep: c.sleep });

    const tickers = await exchange.getTickers(['BTC', 'NOPE', 'SOL'], 'USDT');

    expect([...tickers.keys()]).toEqual(['BTC', 'SOL']);
    expect(http.maxInFlight).toBe(1);
  });
});
