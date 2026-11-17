// Observable CLI behaviour: commands, option parsing, output lines and exit
// codes. Uses only inputs whose results do not depend on float rounding,
// row ordering of the value table, or cooldown-state serialization.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main, parseArgs } from '../../src/cli.js';
import {
  FakeHttp,
  SIMPLE_HOLDINGS,
  SIMPLE_PRICES,
  binanceTicker,
  captureIO,
  cleanupTempDirs,
  fakeBinance,
  tempDir,
  writeJson,
} from './_support.js';

afterAll(cleanupTempDirs);

async function writeConfig(overrides: Record<string, unknown> = {}, alerts: Record<string, unknown> = {}) {
  const dir = await tempDir();
  const file = await writeJson(dir, 'pricewatch.config.json', {
    exchange: 'binance',
    quote: 'USDT',
    holdings: SIMPLE_HOLDINGS,
    ...overrides,
    alerts: {
      stateFile: 'state/state.json',
      rules: [
        { id: 'btc-high', kind: 'above', asset: 'BTC', price: 55000 },
        { id: 'eth-low', kind: 'below', asset: 'ETH', price: 2000 },
      ],
      notifiers: [{ plugin: 'console' }, { plugin: 'file', path: path.join(dir, 'alerts.jsonl') }],
      ...alerts,
    },
  });
  return { dir, file };
}

describe('parseArgs', () => {
  it('supports inline and separate option values', () => {
    expect(parseArgs(['value', '--config=a.json'])).toMatchObject({ command: 'value', config: 'a.json' });
    expect(parseArgs(['value', '-c', 'b.json'])).toMatchObject({ command: 'value', config: 'b.json' });
    expect(parseArgs(['snapshot', '-o', 'out.json'])).toMatchObject({ command: 'snapshot', out: 'out.json' });
    expect(parseArgs(['pnl', '-t', 'trades.json', '--json'])).toMatchObject({ trades: 'trades.json', json: true });
  });

  it('normalizes exchange and quote overrides', () => {
    expect(parseArgs(['value', '-e', 'KRAKEN', '-q', 'usd'])).toMatchObject({ exchange: 'kraken', quote: 'USD' });
    expect(parseArgs(['value', '--exchange=Binance', '--quote=eur'])).toMatchObject({ exchange: 'binance', quote: 'EUR' });
  });

  it('defaults to pricewatch.config.json and a 60s interval', () => {
    expect(parseArgs(['watch'])).toMatchObject({
      command: 'watch',
      config: 'pricewatch.config.json',
      intervalSec: 60,
      dryRun: false,
      json: false,
    });
  });

  it('parses watch options', () => {
    expect(parseArgs(['watch', '--dry-run', '-i', '30', '--max-runs', '3', '-v'])).toMatchObject({
      dryRun: true,
      intervalSec: 30,
      maxRuns: 3,
      verbose: true,
    });
  });

  it('accepts --help and --version without a command', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it.each([
    [['value', '--interval', '2'], /at least 5 seconds/],
    [['watch', '--max-runs', '0'], /positive integer/],
    [['watch', '--interval', 'soon'], /positive integer/],
    [['value', '--config'], /needs a value/],
    [['value', '--config='], /needs a value/],
    [['value', '-c', '--json'], /needs a value/],
    [['value', '--dry-run'], /--dry-run only applies/],
    [['value', '--out', 'x.json'], /--out only applies/],
    [['value', 'extra'], /unexpected argument/],
    [['check'], /unknown command/],
    [[], /missing command/],
    [['value', '--frobnicate'], /unknown option/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(message as RegExp);
  });
});

describe('pricewatch value', () => {
  it('prints a table with every holding and the totals', async () => {
    const { file } = await writeConfig();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['value', '--config', file], cap.io)).toBe(0);

    const text = cap.stdoutText();
    expect(text).toMatch(/^ASSET\s+QTY\s+PRICE\s+VALUE\s+PNL\s+PNL %$/m);
    expect(text).toMatch(/^BTC\s+2\s+60,000\.00 USDT\s+120,000\.00 USDT\s+20,000\.00 USDT\s+\+20\.00%$/m);
    expect(text).toMatch(/^ETH\s+10\s+3,000\.00 USDT\s+30,000\.00 USDT\s+-5,000\.00 USDT\s+-14\.29%$/m);
    expect(text).toContain('Total value:    150,000.00 USDT');
    expect(text).toContain('Total cost:     135,000.00 USDT');
    expect(text).toContain('Unrealized PnL: 15,000.00 USDT');
  });

  it('prints the valuation as JSON with --json', async () => {
    const { file } = await writeConfig();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['value', '-c', file, '--json'], cap.io)).toBe(0);

    const v = JSON.parse(cap.stdoutText()) as Record<string, unknown>;
    expect(v).toMatchObject({ quote: 'USDT', totalValue: 150000, totalCost: 135000, unrealizedPnl: 15000 });
  });

  it('uses the kraken adapter when the exchange is overridden', async () => {
    const { file } = await writeConfig({ quote: 'USD', holdings: [{ asset: 'BTC', quantity: 1, avgCost: 60000 }] });
    const http = new FakeHttp().on('pair=XBTUSD', {
      status: 200,
      body: { error: [], result: { XXBTZUSD: { a: ['65000'], b: ['65000'], c: ['65000', '1'], o: '64000' } } },
    });
    const cap = captureIO({ http });

    expect(await main(['value', '-c', file, '-e', 'kraken'], cap.io)).toBe(0);

    expect(http.requests[0]?.url).toContain('api.kraken.com');
    expect(cap.stdoutText()).toContain('Total value:    65,000.00 USD');
  });

  it('exits 1 with a message for an unknown exchange', async () => {
    const { file } = await writeConfig({ exchange: 'mtgox' });
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['value', '-c', file], cap.io)).toBe(1);
    expect(cap.err.join('\n')).toMatch(/unknown exchange "mtgox"/);
  });

  it('exits 1 on an invalid config', async () => {
    const { file } = await writeConfig({ holdings: [{ asset: 'BTC', quantity: -1, avgCost: 1 }] });
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['value', '-c', file], cap.io)).toBe(1);
    expect(cap.err.join('\n')).toMatch(/holdings\[0\]\.quantity/);
  });
});

describe('pricewatch pnl', () => {
  it('reports realized and unrealized PnL from a trade export', async () => {
    const { dir, file } = await writeConfig();
    const trades = await writeJson(dir, 'trades.json', [
      { orderId: '1', asset: 'BTC', side: 'buy', quantity: '2', price: '50000', fee: '0', timestamp: '2026-06-01T00:00:00Z' },
      { orderId: '2', asset: 'btc', side: 'SELL', quantity: 1, price: 55000, fee: 0, timestamp: '2026-07-01T00:00:00+02:00' },
      { orderId: '2', asset: 'btc', side: 'SELL', quantity: 1, price: 55000, fee: 0, timestamp: '2026-07-01T00:00:00+02:00' },
    ]);
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['pnl', '-c', file, '--trades', trades], cap.io)).toBe(0);

    expect(cap.out).toEqual([
      'Trades:         2',
      'Fees paid:      0.00 USDT',
      'Realized PnL:   5,000.00 USDT',
      'Unrealized PnL: 10,000.00 USDT',
      'Total PnL:      15,000.00 USDT',
    ]);
  });

  it('supports --json', async () => {
    const { dir, file } = await writeConfig();
    const trades = await writeJson(dir, 'trades.json', [
      { orderId: '7', asset: 'ETH', side: 'buy', quantity: 4, price: 2500, fee: 10, timestamp: 1_780_000_000_000 },
    ]);
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['pnl', '-c', file, '-t', trades, '--json'], cap.io)).toBe(0);

    expect(JSON.parse(cap.stdoutText())).toMatchObject({
      quote: 'USDT',
      trades: 1,
      fees: 10,
      realizedPnl: 0,
      unrealizedPnl: 1990,
      totalPnl: 1990,
    });
  });

  it('reads tradesFile from the config, relative to the config file', async () => {
    const { dir } = await writeConfig();
    await writeJson(dir, 'fills.json', [
      { orderId: '1', asset: 'ETH', side: 'buy', quantity: 1, price: 2000, timestamp: 1_780_000_000_000 },
    ]);
    const file = await writeJson(dir, 'with-trades.json', { quote: 'USDT', tradesFile: 'fills.json' });
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['pnl', '-c', file], cap.io)).toBe(0);
    expect(cap.out).toContain('Unrealized PnL: 1,000.00 USDT');
  });

  it('exits 2 without a trade export', async () => {
    const { file } = await writeConfig();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['pnl', '-c', file], cap.io)).toBe(2);
    expect(cap.err.join('\n')).toMatch(/trade export/);
  });
});

describe('pricewatch alerts', () => {
  it('--dry-run lists the events without notifying', async () => {
    const { dir, file } = await writeConfig();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['alerts', '-c', file, '--dry-run'], cap.io)).toBe(0);

    expect(cap.out).toEqual(['[dry-run] BTC above 55000: last 60000', '1 alert(s) fired, 0 in cooldown']);
    await expect(readFile(path.join(dir, 'alerts.jsonl'), 'utf8')).rejects.toThrow();
  });

  it('notifies through the plugins named in the config', async () => {
    const { dir, file } = await writeConfig();
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['alerts', '-c', file], cap.io)).toBe(0);

    expect(cap.out).toEqual([
      '[ALERT] 2026-09-01T12:00:00.000Z BTC above 55000: last 60000',
      '1 alert(s) fired, 0 in cooldown',
    ]);
    const rows = (await readFile(path.join(dir, 'alerts.jsonl'), 'utf8')).trim().split('\n');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0] ?? '{}')).toMatchObject({ ruleId: 'btc-high', firedAt: '2026-09-01T12:00:00.000Z' });
  });

  it('only requests the assets the rules need', async () => {
    const { file } = await writeConfig({}, { rules: [{ id: 'sol', kind: 'change_pct', asset: 'sol', pct: 5 }] });
    const http = new FakeHttp().on('symbol=SOLUSDT', binanceTicker('SOLUSDT', 150, -7.5));
    const cap = captureIO({ http });

    expect(await main(['alerts', '-c', file, '--dry-run'], cap.io)).toBe(0);

    expect(http.requests).toHaveLength(1);
    expect(cap.out).toEqual(['[dry-run] SOL moved -7.50% in 24h', '1 alert(s) fired, 0 in cooldown']);
  });

  it('evaluates portfolio_drawdown against the holdings', async () => {
    const { file } = await writeConfig(
      { holdings: [{ asset: 'ETH', quantity: 10, avgCost: 4000 }] },
      { rules: [{ id: 'dd', kind: 'portfolio_drawdown', pct: 20 }] },
    );
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['alerts', '-c', file, '--dry-run'], cap.io)).toBe(0);

    expect(cap.out).toEqual(['[dry-run] portfolio drawdown -25.00% (limit -20%)', '1 alert(s) fired, 0 in cooldown']);
  });

  it('warns and exits 0 when no rules are configured', async () => {
    const { file } = await writeConfig({}, { rules: [] });
    const cap = captureIO({ http: fakeBinance(SIMPLE_PRICES) });

    expect(await main(['alerts', '-c', file], cap.io)).toBe(0);
    expect(cap.err.join('\n')).toMatch(/no alert rules/);
  });
});

describe('pricewatch watch', () => {
  it('checks repeatedly, sleeping for the interval in between', async () => {
    const { file } = await writeConfig();
    const sleeps: number[] = [];
    const cap = captureIO({
      http: fakeBinance(SIMPLE_PRICES),
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    expect(await main(['watch', '-c', file, '--dry-run', '--interval', '30', '--max-runs', '3'], cap.io)).toBe(0);

    expect(cap.out.filter((l) => l.endsWith('in cooldown'))).toHaveLength(3);
    expect(sleeps.filter((ms) => ms === 30_000)).toHaveLength(2);
  });
});

describe('misc commands', () => {
  it('plugins lists the built-in notifiers and exchanges', async () => {
    const cap = captureIO();
    expect(await main(['plugins'], cap.io)).toBe(0);
    const text = cap.stdoutText();
    for (const name of ['console', 'file', 'webhook']) expect(text).toMatch(new RegExp(`^${name}\\s`, 'm'));
    expect(text).toContain('exchanges: binance, kraken');
  });

  it('--version prints a semver version', async () => {
    const cap = captureIO();
    expect(await main(['--version'], cap.io)).toBe(0);
    expect(cap.out[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help prints the usage on stdout', async () => {
    const cap = captureIO();
    expect(await main(['--help'], cap.io)).toBe(0);
    expect(cap.stdoutText()).toContain('Usage: pricewatch <command> [options]');
    for (const cmd of ['value', 'pnl', 'alerts', 'watch', 'snapshot', 'plugins']) {
      expect(cap.stdoutText()).toMatch(new RegExp(`^  ${cmd}\\s`, 'm'));
    }
  });

  it('usage errors exit 2 and print the usage on stderr', async () => {
    const cap = captureIO();
    expect(await main(['value', '--bogus'], cap.io)).toBe(2);
    expect(cap.err[0]).toBe('error: unknown option --bogus');
    expect(cap.err.join('\n')).toContain('Usage: pricewatch');
  });
});
