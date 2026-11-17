// Trap X01: the notifier plugins under src/plugins/builtin/ are never imported
// statically; they are loaded at runtime by the name given in the config.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PluginError, listBuiltinPlugins, loadNotifier, type AlertEvent } from '../../src/index.js';
import { FakeHttp, NOW, cleanupTempDirs, tempDir } from './_support.js';

const EVENT: AlertEvent = {
  ruleId: 'btc-high',
  kind: 'above',
  asset: 'BTC',
  message: 'BTC above 70000: last 71000',
  observed: 71000,
  threshold: 70000,
  firedAt: NOW,
};

function context(http = new FakeHttp()) {
  const lines: string[] = [];
  return { lines, http, ctx: { http, stdout: (line: string) => lines.push(line) } };
}

afterAll(cleanupTempDirs);

describe('notifier plugins loaded by name', () => {
  it('lists every built-in plugin with a description', async () => {
    const plugins = await listBuiltinPlugins();
    const names = plugins.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['console', 'file', 'webhook']));
    for (const plugin of plugins.filter((p) => ['console', 'file', 'webhook'].includes(p.name))) {
      expect(plugin.description.length).toBeGreaterThan(0);
    }
  });

  it('"file" appends one JSON line per alert', async () => {
    const dir = await tempDir();
    const target = path.join(dir, 'nested', 'alerts.jsonl');
    const { ctx } = context();

    const notifier = await loadNotifier({ plugin: 'file', path: target }, ctx);
    await notifier.notify(EVENT);
    await notifier.notify({ ...EVENT, ruleId: 'second' });

    expect(notifier.name).toBe('file');
    const rows = (await readFile(target, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ruleId: 'btc-high',
      kind: 'above',
      asset: 'BTC',
      message: 'BTC above 70000: last 71000',
      observed: 71000,
      threshold: 70000,
      firedAt: '2026-09-01T12:00:00.000Z',
    });
    expect(rows[1]).toMatchObject({ ruleId: 'second' });
  });

  it('"file" requires a path option', async () => {
    const { ctx } = context();
    await expect(loadNotifier({ plugin: 'file' }, ctx)).rejects.toBeInstanceOf(PluginError);
  });

  it('"console" prints an [ALERT] line through the context', async () => {
    const { ctx, lines } = context();
    const notifier = await loadNotifier({ plugin: 'console' }, ctx);
    await notifier.notify(EVENT);
    expect(notifier.name).toBe('console');
    expect(lines).toEqual(['[ALERT] 2026-09-01T12:00:00.000Z BTC above 70000: last 71000']);
  });

  it('"webhook" POSTs the alert through the injected http client', async () => {
    const http = new FakeHttp().on('hooks.example.test', { status: 204, body: '' });
    const { ctx } = context(http);

    const notifier = await loadNotifier(
      { plugin: 'webhook', url: 'https://hooks.example.test/pw', headers: { 'x-token': 'abc' } },
      ctx,
    );
    await notifier.notify(EVENT);

    expect(notifier.name).toBe('webhook');
    expect(http.requests).toHaveLength(1);
    const req = http.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('https://hooks.example.test/pw');
    expect(req?.headers).toMatchObject({ 'x-token': 'abc' });
    expect(req?.body).toMatchObject({ type: 'pricewatch.alert', ruleId: 'btc-high', firedAt: '2026-09-01T12:00:00.000Z' });
  });

  it('"webhook" fails the delivery on a non-2xx answer', async () => {
    const http = new FakeHttp().on('hooks.example.test', { status: 500, body: 'boom' });
    const { ctx } = context(http);
    const notifier = await loadNotifier({ plugin: 'webhook', url: 'https://hooks.example.test/pw' }, ctx);
    await expect(notifier.notify(EVENT)).rejects.toThrow();
  });

  it('"webhook" requires an http(s) url', async () => {
    const { ctx } = context();
    await expect(loadNotifier({ plugin: 'webhook', url: 'ftp://nope' }, ctx)).rejects.toBeInstanceOf(PluginError);
  });

  it('rejects unknown plugin names with PluginError', async () => {
    const { ctx } = context();
    await expect(loadNotifier({ plugin: 'carrier-pigeon' }, ctx)).rejects.toBeInstanceOf(PluginError);
  });

  it('refuses names that could escape the plugin directory', async () => {
    const { ctx } = context();
    await expect(loadNotifier({ plugin: '../loader' }, ctx)).rejects.toBeInstanceOf(PluginError);
    await expect(loadNotifier({ plugin: 'Console' }, ctx)).rejects.toBeInstanceOf(PluginError);
  });
});
