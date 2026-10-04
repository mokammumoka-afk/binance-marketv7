import test from 'node:test';
import assert from 'node:assert/strict';
import { futuresContextEngine } from '../lib/futures/futuresContextEngine.js';
import { LiquidationStream } from '../lib/binance/liquidations.js';
import { BinanceFuturesClient } from '../lib/binance/futures.js';
import { assetKeywordsFor } from '../lib/external/news.js';

test('FuturesContextEngine: extreme positive funding warns on LONG and supports SHORT', () => {
  const snapshot = { fundingRate: 0.001, openInterestHistory: [], longShortRatioHistory: [] }; // 0.1%/8h = extreme
  const longCtx = futuresContextEngine.build({ direction: 'LONG', futuresSnapshot: snapshot });
  const shortCtx = futuresContextEngine.build({ direction: 'SHORT', futuresSnapshot: snapshot });
  assert.ok(longCtx.warnings.some((w) => /long-squeeze/i.test(w)));
  assert.ok(shortCtx.reasons.some((r) => /tailwind for shorts/i.test(r)));
  assert.ok(Math.abs(longCtx.facts.fundingRatePct - 0.1) < 1e-9);
});

test('FuturesContextEngine: extreme negative funding supports LONG and warns SHORT', () => {
  const snapshot = { fundingRate: -0.001 };
  const longCtx = futuresContextEngine.build({ direction: 'LONG', futuresSnapshot: snapshot });
  const shortCtx = futuresContextEngine.build({ direction: 'SHORT', futuresSnapshot: snapshot });
  assert.ok(longCtx.reasons.some((r) => /tailwind for longs/i.test(r)));
  assert.ok(shortCtx.warnings.some((w) => /short-squeeze/i.test(w)));
});

test('FuturesContextEngine: rising OI is a reason, falling OI is a warning', () => {
  const rising = futuresContextEngine.build({
    direction: 'LONG',
    futuresSnapshot: { openInterestHistory: [{ t: 1, oi: 1000 }, { t: 2, oi: 1100 }] },
  });
  assert.ok(rising.reasons.some((r) => /Open interest rising/.test(r)));
  const falling = futuresContextEngine.build({
    direction: 'LONG',
    futuresSnapshot: { openInterestHistory: [{ t: 1, oi: 1000 }, { t: 2, oi: 900 }] },
  });
  assert.ok(falling.warnings.some((w) => /Open interest falling/.test(w)));
});

test('FuturesContextEngine: extreme long/short account ratio is a contrarian warning', () => {
  const ctx = futuresContextEngine.build({
    direction: 'LONG',
    futuresSnapshot: { longShortRatioHistory: [{ t: 1, ratio: 3.0, longAccount: 0.75, shortAccount: 0.25 }] },
  });
  assert.ok(ctx.warnings.some((w) => /extreme/i.test(w) && /long/i.test(w)));
});

test('FuturesContextEngine: liquidation pressure in the signal direction becomes a supporting reason', () => {
  const ctx = futuresContextEngine.build({
    direction: 'LONG',
    liquidationPressure: { windowMs: 900000, count: 5, longsLiquidatedUsd: 1000, shortsLiquidatedUsd: 200000 },
  });
  assert.ok(ctx.reasons.some((r) => /short liquidations/i.test(r)));
});

test('FuturesContextEngine: Fear & Greed extremes become warnings, mid-range does not', () => {
  const fear = futuresContextEngine.build({ direction: 'LONG', marketContext: { fearGreed: { value: 10, classification: 'Extreme Fear' } } });
  assert.ok(fear.warnings.some((w) => /Extreme Fear/.test(w)));
  const neutral = futuresContextEngine.build({ direction: 'LONG', marketContext: { fearGreed: { value: 50, classification: 'Neutral' } } });
  assert.equal(neutral.warnings.length, 0);
});

test('FuturesContextEngine: never part of a score — output has no numeric score field', () => {
  const ctx = futuresContextEngine.build({ direction: 'LONG', futuresSnapshot: { fundingRate: 0.0005 } });
  assert.equal('score' in ctx, false);
  assert.match(ctx.disclaimer, /not.*backtested/i);
});

test('estimateLiquidation: higher leverage means a liquidation price closer to entry', () => {
  const { estimates } = futuresContextEngine.estimateLiquidation('LONG', 100, [5, 10, 20]);
  assert.ok(estimates['5x'] < estimates['10x']);
  assert.ok(estimates['10x'] < estimates['20x']);
  assert.ok(estimates['20x'] < 100);
  const short = futuresContextEngine.estimateLiquidation('SHORT', 100, [10]).estimates['10x'];
  assert.ok(short > 100);
});

test('LiquidationStream.pressure: sums notional by liquidation side within the time window', () => {
  const s = new LiquidationStream();
  const now = Date.now();
  s.buffer = [
    { symbol: 'BTCUSDT', side: 'SELL', quoteQty: 1000, time: now - 1000 }, // a LONG got liquidated
    { symbol: 'BTCUSDT', side: 'BUY', quoteQty: 500, time: now - 2000 }, // a SHORT got liquidated
    { symbol: 'BTCUSDT', side: 'SELL', quoteQty: 2000, time: now - 20 * 60_000 }, // outside the 15m window
    { symbol: 'ETHUSDT', side: 'SELL', quoteQty: 9999, time: now - 500 }, // different symbol, excluded
  ];
  const p = s.pressure('BTCUSDT', 15 * 60_000);
  assert.equal(p.count, 2);
  assert.equal(p.longsLiquidatedUsd, 1000);
  assert.equal(p.shortsLiquidatedUsd, 500);
});

test('BinanceFuturesClient targets fapi.binance.com and exposes the expected endpoints', () => {
  const c = new BinanceFuturesClient();
  assert.equal(c.baseUrl, 'https://fapi.binance.com');
  for (const m of ['premiumIndex', 'fundingRateHistory', 'openInterest', 'openInterestHist', 'globalLongShortAccountRatio', 'takerBuySellVolume', 'klines']) {
    assert.equal(typeof c[m], 'function', `missing method ${m}`);
  }
});

test('assetKeywordsFor maps common Binance base assets to real-world news search terms', () => {
  assert.deepEqual(assetKeywordsFor('BTC'), ['bitcoin', 'btc']);
  assert.deepEqual(assetKeywordsFor('eth'), ['ethereum', 'eth', 'ether']);
  assert.deepEqual(assetKeywordsFor('UNKNOWNCOIN'), ['unknowncoin']);
});
