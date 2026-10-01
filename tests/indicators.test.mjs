import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, macd, bollingerBands, stochastic, adx, NOT_READY } from '../lib/indicators/index.js';
import { flatCandle, makeCandles } from './fixtures.mjs';

const asCandles = (closes) => closes.map((c, i) => flatCandle(i, c, c, c, c));

test('SMA matches hand calculation', () => {
  const out = sma([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(out.slice(0, 2), [NOT_READY, NOT_READY]);
  assert.deepEqual(out.slice(2), [2, 3, 4, 5]);
});

test('EMA is seeded with SMA and follows k = 2/(n+1)', () => {
  const out = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.equal(out[1], NOT_READY);
  assert.equal(out[2], 2);
  assert.equal(out[3], 3);
  assert.equal(out[9], 9);
});

// Series: the classic Wilder RSI(14) worked-example closes. The expected values
// below were computed by an INDEPENDENT Python implementation of Wilder's
// smoothing (not copied from the JS code). Published spreadsheets round the
// intermediate averages and differ from these by ~0.07, so they are not used.
const WILDER = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
const WILDER_RSI = [70.46, 66.25, 66.48, 69.35, 66.29, 57.92, 62.88, 63.21, 56.01, 62.34, 54.67, 50.39, 40.02, 41.49, 41.9, 45.5, 37.32, 33.09, 37.79];

test('RSI(14) matches an independent Wilder implementation (no warm-up filter)', () => {
  const out = rsi(asCandles(WILDER), 14, 0);
  WILDER_RSI.forEach((expected, k) => {
    assert.ok(Math.abs(out[14 + k] - expected) < 0.011, `index ${14 + k}: got ${out[14 + k]}, want ${expected}`);
  });
});

test('RSI returns NOT_READY (never a fake number) before the warm-up completes', () => {
  const candles = makeCandles(200);
  const out = rsi(candles, 14, 50);
  for (let i = 0; i < 64; i++) assert.equal(out[i], NOT_READY, `index ${i} must be NOT_READY`);
  assert.equal(typeof out[64], 'number');
  assert.ok(out[199] >= 0 && out[199] <= 100);
});

test('RSI is 100 on a monotonic rise and ~0 on a monotonic fall', () => {
  const up = rsi(asCandles(Array.from({ length: 120 }, (_, i) => 100 + i)), 14, 50);
  const dn = rsi(asCandles(Array.from({ length: 120 }, (_, i) => 300 - i)), 14, 50);
  assert.equal(up[119], 100);
  assert.ok(dn[119] < 0.001);
});

test('ATR equals the bar range when every range is identical and there are no gaps', () => {
  const c = Array.from({ length: 40 }, (_, i) => flatCandle(i, 100, 101, 99, 100));
  const out = atr(c, 14);
  assert.equal(out[13], NOT_READY);
  assert.ok(Math.abs(out[14] - 2) < 1e-9);
  assert.ok(Math.abs(out[39] - 2) < 1e-9);
});

test('Bollinger bands are symmetric around the SMA', () => {
  const c = makeCandles(60);
  const b = bollingerBands(c, 20, 2);
  const i = 59;
  assert.ok(Math.abs(b.upper[i] - b.middle[i] - (b.middle[i] - b.lower[i])) < 1e-9);
});

test('Stochastic %K is bounded 0..100 and MACD histogram = macd - signal', () => {
  const c = makeCandles(200);
  const s = stochastic(c);
  s.percentK.filter((x) => x !== NOT_READY).forEach((x) => assert.ok(x >= 0 && x <= 100));
  const m = macd(c);
  const i = 199;
  assert.ok(Math.abs(m.histogram[i] - (m.macdLine[i] - m.signalLine[i])) < 1e-9);
});

test('ADX stays within 0..100', () => {
  const a = adx(makeCandles(200));
  a.adx.filter((x) => x !== NOT_READY).forEach((x) => assert.ok(x >= 0 && x <= 100));
});
