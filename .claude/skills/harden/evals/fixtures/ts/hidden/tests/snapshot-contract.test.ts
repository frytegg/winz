// Trap X06: the snapshot JSON is a public output contract (README "JSON
// snapshot format"). schemaVersion is never read inside src/ but consumers
// key their parsers on it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../../src/cli.js';
import { SIMPLE_HOLDINGS, SIMPLE_PRICES, captureIO, cleanupTempDirs, fakeBinance, tempDir, writeJson } from './_support.js';

afterAll(cleanupTempDirs);

async function configFile(): Promise<string> {
  const dir = await tempDir();
  return writeJson(dir, 'pricewatch.config.json', {
    exchange: 'binance',
    quote: 'USDT',
    holdings: SIMPLE_HOLDINGS,
    alerts: { stateFile: 'state.json', rules: [], notifiers: [{ plugin: 'console' }] },
  });
}

const HOLDING_KEYS = ['asset', 'quantity', 'avgCost', 'price', 'value', 'unrealizedPnl', 'unrealizedPnlPct', 'priceSource'];

function checkContract(doc: Record<string, unknown>): void {
  expect(Object.keys(doc)).toEqual(
    expect.arrayContaining(['schemaVersion', 'generatedAt', 'exchange', 'quote', 'totals', 'holdings']),
  );
  expect(doc.schemaVersion).toBe(1);
  expect(doc.generatedAt).toBe('2026-09-01T12:00:00.000Z');
  expect(doc.exchange).toBe('binance');
  expect(doc.quote).toBe('USDT');
  expect(doc.totals).toEqual({ value: 150000, cost: 135000, unrealizedPnl: 15000, realizedPnl: 0 });

  const holdings = doc.holdings as Array<Record<string, unknown>>;
  expect(holdings.map((h) => h.asset)).toEqual(['BTC', 'ETH']);
  for (const h of holdings) {
    expect(Object.keys(h)).toEqual(expect.arrayContaining(HOLDING_KEYS));
  }
  expect(holdings[0]).toMatchObject({
    asset: 'BTC',
    quantity: 2,
    avgCost: 50000,
    price: 60000,
    value: 120000,
    unrealizedPnl: 20000,
    unrealizedPnlPct: 20,
    priceSource: 'exchange',
  });
  expect(holdings[1]).toMatchObject({ asset: 'ETH', value: 30000, unrealizedPnl: -5000, priceSource: 'exchange' });
}

describe('pricewatch snapshot', () => {
  it('prints the versioned JSON document on stdout', async () => {
    const config = await configFile();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    const code = await main(['snapshot', '--config', config], cap.io);

    expect(code).toBe(0);
    checkContract(JSON.parse(cap.stdoutText()) as Record<string, unknown>);
  });

  it('writes the same document with --out', async () => {
    const config = await configFile();
    const out = path.join(path.dirname(config), 'reports', 'snap.json');
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    const code = await main(['snapshot', '-c', config, '-o', out], cap.io);

    expect(code).toBe(0);
    expect(cap.out).toEqual([]);
    checkContract(JSON.parse(await readFile(out, 'utf8')) as Record<string, unknown>);
  });

  it('reports the exchange actually used when overridden', async () => {
    const config = await configFile();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    await main(['snapshot', '--config', config, '--exchange', 'BINANCE'], cap.io);

    expect((JSON.parse(cap.stdoutText()) as { exchange: string }).exchange).toBe('binance');
  });
});
