// Traps X02 and X03: importing the package entry point (src/index.ts) must
// register the built-in adapters through the side-effect import, and the
// kraken adapter is reached only through registry resolution by name.
// This file deliberately imports nothing but the public entry point.
import { describe, expect, it } from 'vitest';
import { ExchangeError, createExchange, listExchanges } from '../../src/index.js';
import { FakeHttp, fakeBinance, noSleep, NOW } from './_support.js';

const KRAKEN_BTC_USD = {
  status: 200,
  body: {
    error: [],
    result: {
      XXBTZUSD: {
        a: ['65010.0', '1', '1.000'],
        b: ['64990.0', '2', '2.000'],
        c: ['65000.0', '0.01000000'],
        o: '62500.0',
      },
    },
  },
};

describe('exchange registry via the package entry point', () => {
  it('registers binance and kraken on import', () => {
    expect(listExchanges()).toEqual(expect.arrayContaining(['binance', 'kraken']));
  });

  it('resolves "kraken" by name and parses its ticker payload', async () => {
    const http = new FakeHttp().on('/0/public/Ticker?pair=XBTUSD', KRAKEN_BTC_USD);
    const exchange = createExchange('kraken', { http, sleep: noSleep, now: () => NOW });

    const ticker = await exchange.getTicker('BTC', 'USD');

    expect(exchange.name).toBe('kraken');
    expect(http.requests[0]?.url).toBe('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
    expect(ticker.symbol).toBe('BTC/USD');
    expect(ticker.base).toBe('BTC');
    expect(ticker.quote).toBe('USD');
    expect(ticker.last).toBe(65000);
    expect(ticker.bid).toBe(64990);
    expect(ticker.ask).toBe(65010);
    expect(ticker.change24hPct).toBeCloseTo(4, 9);
  });

  it('maps DOGE to kraken\'s XDG code', async () => {
    const http = new FakeHttp().on('pair=XDGUSD', {
      status: 200,
      body: { error: [], result: { XDGUSD: { a: ['0.2'], b: ['0.19'], c: ['0.2', '1'], o: '0.2' } } },
    });
    const exchange = createExchange('kraken', { http, sleep: noSleep });
    expect((await exchange.getTicker('DOGE', 'USD')).last).toBe(0.2);
  });

  it('surfaces kraken API errors as ExchangeError', async () => {
    const http = new FakeHttp().on('/0/public/Ticker', { status: 200, body: { error: ['EQuery:Unknown asset pair'] } });
    const exchange = createExchange('kraken', { http, sleep: noSleep });
    await expect(exchange.getTicker('FOO', 'USD')).rejects.toBeInstanceOf(ExchangeError);
  });

  it('resolves "binance" by name', async () => {
    const http = fakeBinance({ ETHUSDT: [2500, -1.5] });
    const exchange = createExchange('binance', { http, sleep: noSleep });

    const ticker = await exchange.getTicker('ETH', 'USDT');

    expect(exchange.name).toBe('binance');
    expect(http.requests[0]?.url).toBe('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT');
    expect(ticker).toMatchObject({ symbol: 'ETH/USDT', last: 2500, change24hPct: -1.5 });
  });

  it('honours a custom baseUrl', async () => {
    const http = fakeBinance({ BTCUSDT: 1 });
    const exchange = createExchange('binance', { http, sleep: noSleep, baseUrl: 'https://testnet.example/' });
    await exchange.getTicker('BTC', 'USDT');
    expect(http.requests[0]?.url).toBe('https://testnet.example/api/v3/ticker/24hr?symbol=BTCUSDT');
  });

  it('rejects unregistered names', () => {
    expect(() => createExchange('mtgox', { http: new FakeHttp() })).toThrow(ExchangeError);
  });
});
