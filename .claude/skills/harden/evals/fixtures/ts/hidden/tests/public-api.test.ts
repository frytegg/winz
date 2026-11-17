// Trap X04: splitPair (and the rest of the README "Library usage" surface) is
// exported for external consumers even though nothing inside src/ calls it.
import { describe, expect, it } from 'vitest';
import * as api from '../../src/index.js';

const DOCUMENTED_FUNCTIONS = [
  'createExchange',
  'registerExchange',
  'listExchanges',
  'splitPair',
  'formatPair',
  'normalizeAsset',
  'valuePortfolio',
  'valueWithTickers',
  'buildPositions',
  'parseTradeRecord',
  'dedupeTrades',
  'evaluateRule',
  'AlertEngine',
  'loadNotifier',
  'listBuiltinPlugins',
  'loadConfig',
  'validateConfig',
  'buildSnapshot',
  'renderValuationTable',
];

describe('public library API', () => {
  it.each(DOCUMENTED_FUNCTIONS)('exports %s', (name) => {
    expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
  });

  it('splitPair splits and normalizes both legs', () => {
    expect(api.splitPair('xbt/usd')).toEqual({ base: 'BTC', quote: 'USD' });
    expect(api.splitPair('eth-usdt')).toEqual({ base: 'ETH', quote: 'USDT' });
    expect(api.splitPair('SOL_EUR')).toEqual({ base: 'SOL', quote: 'EUR' });
    expect(api.splitPair('doge:usdt')).toEqual({ base: 'DOGE', quote: 'USDT' });
  });

  it('splitPair rejects strings that are not BASE/QUOTE', () => {
    expect(() => api.splitPair('BTCUSDT')).toThrow();
    expect(() => api.splitPair('BTC/')).toThrow();
    expect(() => api.splitPair('A/B/C')).toThrow();
  });

  it('formatPair and normalizeAsset give canonical codes', () => {
    expect(api.formatPair('xbt', 'zusd')).toBe('BTC/USD');
    expect(api.normalizeAsset('  xdg ')).toBe('DOGE');
  });

  it('exposes the snapshot schema version and error classes', () => {
    expect(api.SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(new api.ConfigError('x')).toBeInstanceOf(api.PricewatchError);
    expect(new api.PluginError('x')).toBeInstanceOf(api.PricewatchError);
    expect(new api.UnsupportedRuleError('x')).toBeInstanceOf(api.PricewatchError);
  });
});
