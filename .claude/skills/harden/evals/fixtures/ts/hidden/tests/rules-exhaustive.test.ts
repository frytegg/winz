// Trap X07: the `default` branch of evaluateRule looks unreachable to the type
// checker, but rules arrive from untyped JSON through the library API and a
// kind without an evaluator must fail loudly rather than never fire.
import { describe, expect, it } from 'vitest';
import {
  AlertEngine,
  MemoryStateStore,
  UnsupportedRuleError,
  evaluateRule,
  type AlertRule,
  type Ticker,
} from '../../src/index.js';
import { NOW } from './_support.js';

const tickers = new Map<string, Ticker>([
  ['BTC', { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', last: 71000, change24hPct: 5, timestamp: NOW }],
]);

const crosses = { id: 'x', kind: 'crosses', asset: 'BTC', price: 70000 } as unknown as AlertRule;

describe('unknown rule kinds', () => {
  it('evaluateRule throws UnsupportedRuleError naming the kind', () => {
    expect(() => evaluateRule(crosses, { tickers, now: NOW })).toThrow(UnsupportedRuleError);
    expect(() => evaluateRule(crosses, { tickers, now: NOW })).toThrow(/crosses/);
  });

  it('the engine does not silently skip them', async () => {
    const engine = new AlertEngine({ rules: [crosses], notifiers: [], state: new MemoryStateStore(), now: () => NOW });
    await expect(engine.check(tickers)).rejects.toBeInstanceOf(UnsupportedRuleError);
  });

  it('known kinds still evaluate', () => {
    const above = { id: 'a', kind: 'above', asset: 'BTC', price: 70000 } as AlertRule;
    const pct = { id: 'p', kind: 'change_pct', asset: 'BTC', pct: 5 } as AlertRule;
    expect(evaluateRule(above, { tickers, now: NOW })).toMatchObject({ ruleId: 'a', kind: 'above', firedAt: NOW });
    expect(evaluateRule(pct, { tickers, now: NOW })).toMatchObject({ ruleId: 'p', observed: 5, threshold: 5 });
  });
});
