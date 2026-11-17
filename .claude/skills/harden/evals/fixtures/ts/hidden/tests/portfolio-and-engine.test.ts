// Library behaviour that the README documents: trade import, average-cost
// positions, cooldowns and config defaults. Inputs are chosen so the results
// are exact in binary floating point and independent of the id representation.
import { describe, expect, it } from 'vitest';
import {
  AlertEngine,
  MemoryStateStore,
  buildPositions,
  dedupeTrades,
  parseTradeRecord,
  validateConfig,
  type AlertEvent,
  type AlertRule,
  type RawTradeRecord,
  type Ticker,
} from '../../src/index.js';
import { NOW } from './_support.js';

function fill(orderId: string, side: string, quantity: number, price: number, ts: string, fee = 0): RawTradeRecord {
  return { orderId, asset: 'btc', side, quantity: String(quantity), price: String(price), fee: String(fee), timestamp: ts };
}

describe('trade import', () => {
  it('parses and normalizes a raw record', () => {
    const t = parseTradeRecord(fill('10', 'Buy', 0.5, 40000, '2026-06-02T11:15:00+02:00', 4));
    expect(t).toMatchObject({ asset: 'BTC', side: 'buy', quantity: 0.5, price: 40000, fee: 4 });
    expect(t.timestamp).toBe(Date.UTC(2026, 5, 2, 9, 15));
  });

  it('rejects bad sides and naive timestamps', () => {
    expect(() => parseTradeRecord(fill('1', 'hold', 1, 1, '2026-06-02T09:15:00Z'))).toThrow();
    expect(() => parseTradeRecord(fill('1', 'buy', 1, 1, '2026-06-02T09:15:00'))).toThrow();
  });

  it('dedupes rows by order id keeping the first, in input order', () => {
    const rows = [
      fill('1', 'buy', 1, 100, '2026-06-01T00:00:00Z'),
      fill('2', 'buy', 1, 200, '2026-06-02T00:00:00Z'),
      fill('1', 'buy', 1, 999, '2026-06-01T00:00:00Z'),
      fill('3', 'buy', 1, 300, '2026-06-03T00:00:00Z'),
    ].map(parseTradeRecord);
    expect(dedupeTrades(rows).map((t) => t.price)).toEqual([100, 200, 300]);
  });

  it('builds average-cost positions with fees and realized PnL', () => {
    const book = buildPositions(
      [
        fill('1', 'buy', 2, 100, '2026-06-01T00:00:00Z', 2),
        fill('3', 'sell', 1, 150, '2026-06-03T00:00:00Z', 1),
        fill('2', 'buy', 2, 200, '2026-06-02T00:00:00Z', 2),
      ].map(parseTradeRecord),
    );
    // cost basis 2*100+2 + 2*200+2 = 604 over 4 units = 151; sell 1 @150 fee 1 -> -2
    expect(book.holdings).toEqual([{ asset: 'BTC', quantity: 3, avgCost: 151 }]);
    expect(book.realizedPnl).toBe(-2);
    expect(book.fees).toBe(5);
  });

  it('drops positions that are fully closed and rejects oversells', () => {
    const closed = buildPositions(
      [fill('1', 'buy', 4, 10, '2026-06-01T00:00:00Z'), fill('2', 'sell', 4, 15, '2026-06-02T00:00:00Z')].map(
        parseTradeRecord,
      ),
    );
    expect(closed.holdings).toEqual([]);
    expect(closed.realizedPnl).toBe(20);
    expect(() => buildPositions([parseTradeRecord(fill('1', 'sell', 1, 10, '2026-06-01T00:00:00Z'))])).toThrow();
  });
});

describe('alert cooldowns', () => {
  const btc = (last: number) =>
    new Map<string, Ticker>([['BTC', { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', last, timestamp: NOW }]]);

  it('uses the per-rule cooldown, falling back to the default', async () => {
    const rules: AlertRule[] = [
      { id: 'fast', kind: 'above', asset: 'BTC', price: 100, cooldownMinutes: 5 },
      { id: 'slow', kind: 'above', asset: 'BTC', price: 100 },
    ];
    const seen: AlertEvent[] = [];
    let now = NOW;
    const engine = new AlertEngine({
      rules,
      notifiers: [{ name: 'rec', notify: async (e) => void seen.push(e) }],
      state: new MemoryStateStore(),
      defaultCooldownMinutes: 30,
      now: () => now,
    });

    const first = await engine.check(btc(200));
    now = NOW + 6 * 60_000;
    const second = await engine.check(btc(200));
    now = NOW + 31 * 60_000;
    const third = await engine.check(btc(200));

    expect(first.fired.map((e) => e.ruleId)).toEqual(['fast', 'slow']);
    expect(first.delivered).toBe(2);
    expect(second.fired.map((e) => e.ruleId)).toEqual(['fast']);
    expect(second.suppressed).toEqual(['slow']);
    expect(third.fired.map((e) => e.ruleId).sort()).toEqual(['fast', 'slow']);
    expect(seen).toHaveLength(5);
  });
});

describe('config defaults', () => {
  it('fills in documented defaults', () => {
    const c = validateConfig({ holdings: [{ asset: 'BTC', quantity: 1, avgCost: 1 }] });
    expect(c.exchange).toBe('binance');
    expect(c.quote).toBe('USDT');
    expect(c.alerts.defaultCooldownMinutes).toBe(60);
    expect(c.alerts.stateFile).toBe('.pricewatch/state.json');
    expect(c.alerts.notifiers).toEqual([{ plugin: 'console' }]);
  });

  it('rejects malformed quiet hours and unknown rule kinds', () => {
    expect(() => validateConfig({ alerts: { quietHours: { start: '25:00', end: '07:00' } } })).toThrow();
    expect(() => validateConfig({ alerts: { rules: [{ id: 'x', kind: 'crosses', asset: 'BTC' }] } })).toThrow();
  });
});
