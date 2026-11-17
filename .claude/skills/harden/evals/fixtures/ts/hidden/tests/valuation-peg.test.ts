// Trap X05: pegged stablecoins without a market are valued at par on purpose
// (README "Pegged assets"); priceSource "peg" makes the fallback visible.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEGGED,
  createExchange,
  renderValuationTable,
  valuePortfolio,
  valueWithTickers,
  type Ticker,
} from '../../src/index.js';
import { fakeBinance, noSleep, NOW } from './_support.js';

describe('pegged asset fallback', () => {
  it('values a pegged asset with no market at 1 and marks it "peg"', async () => {
    const exchange = createExchange('binance', { http: fakeBinance({ BTCUSDT: 60000 }), sleep: noSleep });

    const v = await valuePortfolio(
      [
        { asset: 'BTC', quantity: 1, avgCost: 50000 },
        { asset: 'USDC', quantity: 1500, avgCost: 1 },
        { asset: 'USDT', quantity: 200, avgCost: 1 },
      ],
      exchange,
      { quote: 'USDT', now: () => NOW },
    );

    const byAsset = Object.fromEntries(v.holdings.map((h) => [h.asset, h]));
    expect(byAsset.USDC).toMatchObject({ price: 1, value: 1500, priceSource: 'peg' });
    expect(byAsset.USDT).toMatchObject({ price: 1, value: 200, priceSource: 'quote' });
    expect(byAsset.BTC).toMatchObject({ price: 60000, value: 60000, priceSource: 'exchange' });
    expect(v.totalValue).toBe(61700);
  });

  it('prefers a real market over the peg when the venue has one', async () => {
    const exchange = createExchange('binance', { http: fakeBinance({ USDCUSDT: 0.9998 }), sleep: noSleep });

    const v = await valuePortfolio([{ asset: 'USDC', quantity: 100, avgCost: 1 }], exchange, { quote: 'USDT' });

    expect(v.holdings[0]?.price).toBe(0.9998);
    expect(v.holdings[0]?.priceSource).toBe('exchange');
  });

  it('honours a custom pegged list', () => {
    const tickers = new Map<string, Ticker>();
    const v = valueWithTickers([{ asset: 'EURC', quantity: 10, avgCost: 1 }], tickers, {
      quote: 'EUR',
      pegged: ['EURC'],
      now: () => NOW,
    });
    expect(v.holdings[0]).toMatchObject({ price: 1, value: 10, priceSource: 'peg' });
  });

  it('ships the documented default peg list', () => {
    expect([...DEFAULT_PEGGED]).toEqual(expect.arrayContaining(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD']));
  });

  it('marks non-exchange prices with * in the table', async () => {
    const exchange = createExchange('binance', { http: fakeBinance({ BTCUSDT: 60000 }), sleep: noSleep });
    const v = await valuePortfolio(
      [
        { asset: 'BTC', quantity: 1, avgCost: 50000 },
        { asset: 'DAI', quantity: 10, avgCost: 1 },
      ],
      exchange,
      { quote: 'USDT' },
    );
    const table = renderValuationTable(v);
    expect(table).toMatch(/^DAI\*/m);
    expect(table).toMatch(/^BTC\s/m);
  });
});
