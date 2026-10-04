import test from 'node:test';
import assert from 'node:assert/strict';
import { scanWatchlist, toTrackerRecordShape, checkCronSecret } from '../lib/cron/alertScan.js';
import { cloneDefaultConfig } from '../lib/config/strategyConfig.js';
import { makeCandles } from './fixtures.mjs';

function configWithAlerts(overrides = {}) {
  const cfg = cloneDefaultConfig();
  cfg.alerts = { enabled: true, minScoreForAlert: 1, requireConfirmedState: false, ...overrides };
  // make the engine easy to satisfy so the fixture reliably produces a directional state
  cfg.requireHTFAlignment = false;
  cfg.requireVolumeConfirmation = false;
  cfg.requirePOCInteraction = false;
  cfg.minScore = 1;
  cfg.minRR = 0.01;
  return cfg;
}

test('checkCronSecret: rejects when CRON_SECRET is unset, accepts header or query match', () => {
  assert.equal(checkCronSecret({ expectedSecret: null, headerSecret: 'x' }).ok, false);
  assert.equal(checkCronSecret({ expectedSecret: 'abc', headerSecret: 'abc' }).ok, true);
  assert.equal(checkCronSecret({ expectedSecret: 'abc', querySecret: 'abc' }).ok, true);
  assert.equal(checkCronSecret({ expectedSecret: 'abc', headerSecret: 'wrong' }).ok, false);
});

test('checkCronSecret: trusts Vercel\'s own cron header only when actually running on Vercel', () => {
  assert.equal(checkCronSecret({ expectedSecret: 'abc', isVercelCronHeader: true, isVercelRuntime: true }).ok, true);
  assert.equal(checkCronSecret({ expectedSecret: 'abc', isVercelCronHeader: true, isVercelRuntime: false }).ok, false, 'a spoofed header off-Vercel must not bypass the secret');
});

test('scanWatchlist: never evaluates more than maxSymbols (bounded serverless duration)', async () => {
  const candles = makeCandles(400, { seed: 1 });
  let calls = 0;
  const loadCandles = async () => {
    calls++;
    return { candles, validation: { valid: true, gaps: [] } };
  };
  const cfg = configWithAlerts();
  await scanWatchlist({ config: cfg, watchlist: ['A', 'B', 'C', 'D', 'E'], loadCandles, maxSymbols: 2 });
  assert.equal(calls, 2 * 3); // 2 symbols x (htf+mtf+ltf)
});

test('scanWatchlist: alerts.enabled=false means nothing ever qualifies, regardless of score', async () => {
  const candles = makeCandles(400, { seed: 2 });
  const loadCandles = async () => ({ candles, validation: { valid: true, gaps: [] } });
  const cfg = configWithAlerts({ enabled: false });
  const { qualifying } = await scanWatchlist({ config: cfg, watchlist: ['BTCUSDT'], loadCandles });
  assert.equal(qualifying.length, 0);
});

test('scanWatchlist: minScoreForAlert actually gates — raising it past the live score excludes the symbol', async () => {
  const candles = makeCandles(400, { seed: 4, drift: 0.0015 }); // trending fixture, should score meaningfully
  const loadCandles = async () => ({ candles, validation: { valid: true, gaps: [] } });

  const lax = configWithAlerts({ minScoreForAlert: 1 });
  const { qualifying: lenient } = await scanWatchlist({ config: lax, watchlist: ['BTCUSDT'], loadCandles });

  const strict = configWithAlerts({ minScoreForAlert: 99.9 });
  const { qualifying: tough } = await scanWatchlist({ config: strict, watchlist: ['BTCUSDT'], loadCandles });

  assert.ok(lenient.length >= tough.length);
  if (lenient.length > 0) assert.equal(tough.length, 0);
});

test('scanWatchlist: requireConfirmedState excludes CANDIDATE-only signals', async () => {
  const candles = makeCandles(400, { seed: 6 });
  const loadCandles = async () => ({ candles, validation: { valid: true, gaps: [] } });
  const cfg = configWithAlerts({ requireConfirmedState: true, minScoreForAlert: 1 });
  const { qualifying } = await scanWatchlist({ config: cfg, watchlist: ['BTCUSDT'], loadCandles });
  for (const q of qualifying) assert.ok(q.signal.state.endsWith('CONFIRMED'));
});

test('scanWatchlist: a loadCandles failure for one symbol is recorded, not thrown, and other symbols still run', async () => {
  const candles = makeCandles(400, { seed: 7 });
  const loadCandles = async ({ symbol }) => {
    if (symbol === 'BADUSDT') throw new Error('DATA CONNECTION ERROR');
    return { candles, validation: { valid: true, gaps: [] } };
  };
  const cfg = configWithAlerts();
  const { evaluated } = await scanWatchlist({ config: cfg, watchlist: ['BADUSDT', 'BTCUSDT'], loadCandles });
  assert.equal(evaluated[0].symbol, 'BADUSDT');
  assert.match(evaluated[0].error, /DATA CONNECTION ERROR/);
  assert.equal(evaluated[1].error, undefined);
});

test('toTrackerRecordShape: maps raw SignalEngine fields to the notification record shape', () => {
  const signal = {
    symbol: 'ETHUSDT', direction: 'SHORT', timeframe: '15m', score: 83, strategyVersion: 'V1.0.0',
    price: 3000, plan: { stopLoss: 3050, tp1: 2950, tp2: 2900, tp3: 2850, riskRewardToTp1: 1.5 },
    reasons: ['r'], warnings: [],
  };
  const r = toTrackerRecordShape(signal);
  assert.equal(r.entry, 3000);
  assert.equal(r.stopLoss, 3050);
  assert.equal(r.riskReward, 1.5);
  assert.equal(r.direction, 'SHORT');
});
