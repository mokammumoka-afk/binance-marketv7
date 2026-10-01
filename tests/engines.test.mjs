import test from 'node:test';
import assert from 'node:assert/strict';
import { CandleValidator, candleFromRestKline, candleFromWsKline, resampleByTime, onlyClosed, INTERVAL_MS } from '../lib/data/candle.js';
import { VolumeProfileEngine } from '../lib/volumeProfile/volumeProfileEngine.js';
import { MarketStructureEngine } from '../lib/structure/structureEngine.js';
import { RiskEngine } from '../lib/risk/riskEngine.js';
import { classifyDataQuality } from '../lib/data/dataQuality.js';
import { VolumeEngine } from '../lib/volume/volumeEngine.js';
import { makeCandles, flatCandle } from './fixtures.mjs';

test('CandleValidator flags high/low violations, negative volume and gaps', () => {
  const bad = flatCandle(0, 100, 99, 98, 100); // high < max(open, close)
  assert.equal(CandleValidator.validateOne(bad).valid, false);
  const neg = { ...flatCandle(0, 100, 101, 99, 100), volume: -1 };
  assert.equal(CandleValidator.validateOne(neg).valid, false);
  const c = [flatCandle(0, 1, 2, 1, 1), flatCandle(1, 1, 2, 1, 1), flatCandle(4, 1, 2, 1, 1)];
  const v = CandleValidator.validateSeries(c, 60_000);
  assert.equal(v.valid, false);
  assert.equal(v.gaps.length, 1);
  assert.equal(v.gaps[0].missingCandles, 2);
});

test('REST and WS kline parsers agree on the unified model', () => {
  const rest = candleFromRestKline([1000, '1', '2', '0.5', '1.5', '10', 1999, '15', 7, '4', '6', '0']);
  const ws = candleFromWsKline({ t: 1000, T: 1999, o: '1', h: '2', l: '0.5', c: '1.5', v: '10', q: '15', n: 7, V: '4', Q: '6', x: true });
  const { isClosed: a, ...r } = rest; const { isClosed: b, ...w } = ws;
  assert.deepEqual(r, w);
  assert.equal(candleFromRestKline([Date.now(), '1', '1', '1', '1', '1', Date.now() + 60000, '1', 1, '1', '1', '0']).isClosed, false);
});

test('Volume profile: POC lands where volume concentrates and volume is conserved', () => {
  const c = [];
  for (let i = 0; i < 30; i++) c.push(flatCandle(i, 95 + (i % 10), 96 + (i % 10), 94 + (i % 10), 95 + (i % 10), 10));
  for (let i = 30; i < 40; i++) c.push(flatCandle(i, 100, 100.5, 99.5, 100, 1000)); // heavy node at 100
  const vp = new VolumeProfileEngine().build(c, { binCount: 50 });
  assert.ok(vp.ready);
  assert.ok(vp.poc.price >= 99.5 - vp.binSize && vp.poc.price <= 100.5 + vp.binSize, `POC ${vp.poc.price} should sit inside the 99.5-100.5 heavy node`);
  const total = c.reduce((a, x) => a + x.volume, 0);
  assert.ok(Math.abs(vp.totalVolume - total) < 1e-6);
  assert.ok(vp.val <= vp.poc.price && vp.poc.price <= vp.vah);
  assert.equal(vp.methodology, 'OHLCV_APPROXIMATION');
});

test('Volume profile distributes a candle over the bins it spans (not one average price)', () => {
  const c = [flatCandle(0, 100, 110, 100, 105, 100)];
  const vp = new VolumeProfileEngine().build(c, { binCount: 10 });
  const nonZero = vp.bins.filter((x) => x > 0).length;
  assert.equal(nonZero, 10);
});

test('Structure: swings are found at the right indexes and labelled HH/HL', () => {
  // zig-zag with rising peaks and troughs
  const closes = [];
  const peaks = [100, 104, 108, 112];
  for (let k = 0; k < peaks.length; k++) {
    for (let j = 0; j <= 6; j++) closes.push(peaks[k] - 6 + j);
    for (let j = 1; j <= 5; j++) closes.push(peaks[k] - j);
  }
  const candles = closes.map((c, i) => flatCandle(i, c, c + 0.2, c - 0.2, c));
  const s = new MarketStructureEngine({ swingLeftBars: 2, swingRightBars: 2, minimumSwingDistancePct: 0 }).analyze(candles);
  assert.ok(s.ready);
  assert.ok(s.highs.length >= 3);
  assert.ok(s.highs.slice(1).every((h) => h.label === 'HH'));
  assert.ok(s.lows.slice(1).every((l) => l.label === 'HL'));
  assert.equal(s.regime, 'TREND_BULLISH');
  assert.ok(s.events.some((e) => e.type === 'BOS' && e.direction === 'BULLISH'));
});

test('Structure is causal: events up to bar k do not change when later candles are added', () => {
  const candles = makeCandles(400, { seed: 3 });
  const eng = new MarketStructureEngine();
  const full = eng.analyze(candles);
  for (const k of [150, 220, 300, 380]) {
    const part = eng.analyze(candles.slice(0, k + 1));
    const fullUpToK = full.events.filter((e) => e.index <= k).map((e) => [e.type, e.direction, e.index, e.price]);
    const partUpToK = part.events.filter((e) => e.index <= k).map((e) => [e.type, e.direction, e.index, e.price]);
    assert.deepEqual(partUpToK, fullUpToK, `look-ahead detected at k=${k}`);
  }
});

test('BOS is only registered on a CLOSE beyond the swing; a wick is a liquidity sweep', () => {
  const base = [];
  const shape = [100, 100, 100, 100, 101, 102, 103, 104, 103, 102, 101, 100, 101, 102, 103];
  shape.forEach((c, i) => base.push(flatCandle(i, c, c + 0.1, c - 0.1, c)));
  // wick above 104.1 but close back below -> sweep, no BOS
  base.push(flatCandle(15, 103, 105.5, 102.9, 103.5));
  const eng = new MarketStructureEngine({ swingLeftBars: 2, swingRightBars: 2, minimumSwingDistancePct: 0 });
  const r = eng.analyze(base);
  assert.ok(!r.events.some((e) => e.type === 'BOS' && e.direction === 'BULLISH' && e.index === 15));
  assert.ok(r.events.some((e) => e.type === 'LIQUIDITY_SWEEP' && e.index === 15));
});

test('Risk engine reproduces the spec example (1000 USDT, 1%, entry 100000, SL 99000)', () => {
  const r = new RiskEngine().suggestPositionSize({ accountSize: 1000, riskPercent: 1, entry: 100000, stopLoss: 99000 });
  assert.equal(r.riskAmount, 10);
  assert.equal(r.riskDistance, 1000);
  assert.ok(Math.abs(r.positionSizeBase - 0.01) < 1e-12);
  assert.ok(Math.abs(r.positionSizeQuote - 1000) < 1e-9);
});

test('Risk engine: stop is on the protective side and TPs follow R multiples', () => {
  const eng = new RiskEngine();
  const structure = { lows: [{ price: 95 }, { price: 98 }], highs: [{ price: 110 }] };
  const sl = eng.computeStopLoss('LONG', 100, { structure, atr: 1, method: 'STRUCTURE_ATR', atrMultiplier: 1.5 });
  assert.ok(sl < 98);
  const tp = eng.computeTakeProfits('LONG', 100, sl, { rMultiples: [1, 2, 3] });
  assert.ok(Math.abs(tp.tp2 - (100 + 2 * (100 - sl))) < 1e-9);
  const shortSl = eng.computeStopLoss('SHORT', 100, { structure, atr: 1, method: 'STRUCTURE_ATR', atrMultiplier: 1.5 });
  assert.ok(shortSl > 110);
});

test('Volume engine labels its delta an estimate and computes relative volume', () => {
  const v = new VolumeEngine().analyze(makeCandles(80));
  assert.ok(v.ready);
  assert.ok(Array.isArray(v.estimatedDelta));
  assert.equal(v.trueDelta, undefined);
  assert.ok(v.lastRelativeVolume > 0);
});

test('resampleByTime aligns to wall-clock buckets and flags the forming bucket', () => {
  const c = makeCandles(10, { stepMs: 15 * 60_000, t0: Date.UTC(2024, 0, 1, 0, 0) }); // 00:00..02:15
  const h = resampleByTime(c.slice(0, 6), INTERVAL_MS['1h']); // 00:00..01:15 -> bucket 01:00 incomplete
  assert.equal(h.length, 2);
  assert.equal(h[0].isClosed, true);
  assert.equal(h[1].isClosed, false);
  assert.equal(onlyClosed(h).length, 1);
  assert.equal(h[0].volume, c.slice(0, 4).reduce((a, x) => a + x.volume, 0));
});

test('Data quality classifier never reports LIVE for stale / gappy / disconnected data', () => {
  assert.equal(classifyDataQuality({ wsStatus: 'CONNECTED', streamAgeMs: 1000 }).state, 'LIVE');
  assert.equal(classifyDataQuality({ wsStatus: 'CONNECTED', streamAgeMs: 60000 }).state, 'STALE');
  assert.equal(classifyDataQuality({ wsStatus: 'CONNECTED', streamAgeMs: 1000, gapCount: 2 }).state, 'DEGRADED');
  assert.equal(classifyDataQuality({ wsStatus: 'RECONNECTING' }).state, 'DISCONNECTED');
  assert.equal(classifyDataQuality({ restOk: false }).state, 'DISCONNECTED');
  assert.equal(classifyDataQuality({ error: 'x' }).state, 'DATA_ERROR');
});
