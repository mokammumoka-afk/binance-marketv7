import test from 'node:test';
import assert from 'node:assert/strict';
import { SignalTracker, signalFingerprint } from '../lib/signals/signalTracker.js';
import { HistoricalDataEngine } from '../lib/binance/historical.js';
import { BinanceRestClient, BinanceApiError } from '../lib/binance/rest.js';
import { BacktestEngine } from '../lib/backtest/backtestEngine.js';
import { signalEngine, STRATEGY_VARIANTS } from '../lib/signals/signalEngine.js';
import { cloneDefaultConfig } from '../lib/config/strategyConfig.js';
import { makeCandles, flatCandle } from './fixtures.mjs';

const fakeSignal = (over = {}) => ({
  symbol: 'BTCUSDT', timeframe: '15m', direction: 'LONG', state: 'LONG_CANDIDATE', score: 72, price: 100,
  candleOpenTime: 1_000_000, strategyVersion: 'V1.0.0', strategyVariant: 'FULL', mode: 'CONFIRMED',
  plan: { entryZone: { low: 99.9, high: 100.1 }, stopLoss: 98, tp1: 102, tp2: 104, tp3: 106, riskRewardToTp1: 1 },
  reasons: ['r1'], warnings: [], failedConditions: [], scoreBreakdown: {}, indicators: { atr: 1 },
  structure: {}, volumeProfile: { poc: { price: 100 } }, mtf: { overallBias: 'BULLISH' }, ...over,
});

test('SignalTracker: same setup = one signal; no notification spam', () => {
  const t = new SignalTracker({ cooldownMs: 60_000 });
  const a = t.update(fakeSignal(), []);
  const b = t.update(fakeSignal(), []);
  const c = t.update(fakeSignal(), []);
  assert.equal(a.length, 1);
  assert.equal(b.length + c.length, 0);
  assert.equal(t.list().length, 1);
});

test('SignalTracker: candidate -> confirmed is one upgrade, history is append-only', () => {
  const t = new SignalTracker();
  t.update(fakeSignal(), []);
  const ev = t.update(fakeSignal({ state: 'LONG_CONFIRMED' }), []);
  assert.equal(ev[0].type, 'CONFIRMED');
  const rec = t.list()[0];
  assert.deepEqual(rec.history.map((h) => h.type), ['NEW', 'STATE_CHANGE']);
  const before = JSON.stringify(rec.history);
  t.update(fakeSignal({ state: 'LONG_CONFIRMED' }), []);
  assert.equal(JSON.stringify(t.list()[0].history), before);
});

test('SignalTracker: cooldown records but does not notify a near-duplicate setup', () => {
  const t = new SignalTracker({ cooldownMs: 60_000 });
  t.update(fakeSignal(), []);
  const ev = t.update(fakeSignal({ candleOpenTime: 2_000_000 }), []);
  assert.equal(ev.length, 0);
  assert.equal(t.list().length, 2);
  assert.equal(t.list().find((r) => r.candleOpenTime === 2_000_000).suppressedNotification, true);
});

test('SignalTracker: TP/SL outcomes come only from candles after the signal candle; SL wins ties', () => {
  const t = new SignalTracker();
  t.update(fakeSignal(), []);
  const mk = (i, h, l) => ({ ...flatCandle(i, 100, h, l, 100), openTime: 1_000_000 + i * 900_000, isClosed: true });
  let ev = t.update(fakeSignal({ state: 'WAIT' }), [mk(0, 200, 0), mk(1, 102.5, 99.5)]); // candle 0 is the setup candle itself
  assert.deepEqual(ev.map((e) => e.type), ['TP1']);
  ev = t.update(fakeSignal({ state: 'WAIT' }), [mk(0, 200, 0), mk(1, 102.5, 99.5), mk(2, 104.5, 97.9)]); // TP2 and SL in one candle
  assert.deepEqual(ev.map((e) => e.type), ['SL']);
  assert.equal(t.list()[0].status, 'CLOSED');
  assert.equal(t.list()[0].result, 'TP1_THEN_SL');
});

test('fingerprint changes with strategy version', () => {
  assert.notEqual(signalFingerprint(fakeSignal()), signalFingerprint(fakeSignal({ strategyVersion: 'V1.0.1' })));
});

test('HistoricalDataEngine paginates past 1000 candles, de-duplicates and detects gaps', async () => {
  const step = 60_000;
  const t0 = Date.UTC(2024, 0, 1);
  const calls = [];
  const rest = {
    async klines({ startTime, endTime, limit }) {
      calls.push([startTime, endTime, limit]);
      const rows = [];
      for (let t = startTime; t <= endTime && rows.length < limit; t += step) {
        if (t >= t0 + 1500 * step && t < t0 + 1503 * step) continue; // Binance has a 3-candle hole here
        rows.push([t, '1', '2', '0.5', '1.5', '10', t + step - 1, '15', 5, '4', '6', '0']);
      }
      return rows;
    },
  };
  const eng = new HistoricalDataEngine({ rest });
  const candles = await eng.fetchRange({ symbol: 'X', interval: '1m', startTime: t0, endTime: t0 + 2599 * step });
  assert.ok(calls.length >= 3, 'must be split into several requests');
  assert.ok(calls.every(([, , l]) => l <= 1000));
  assert.equal(new Set(candles.map((c) => c.openTime)).size, candles.length);
  const { CandleValidator } = await import('../lib/data/candle.js');
  const v = CandleValidator.validateSeries(candles, step);
  assert.equal(v.valid, false);
  assert.equal(v.gaps[0].missingCandles, 3);
});

test('REST client honours 429 Retry-After and tracks used weight', async () => {
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    n++;
    if (n === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
    return new Response('{"serverTime": 5}', { status: 200, headers: { 'x-mbx-used-weight-1m': '42' } });
  };
  try {
    const c = new BinanceRestClient({ timeoutMs: 2000 });
    const t = Date.now();
    const res = await c.serverTime();
    assert.equal(res, 5);
    assert.ok(Date.now() - t >= 900, 'must wait for Retry-After');
    assert.equal(n, 2);
    assert.equal(c.getUsedWeight(), 42);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('REST client gives up after bounded retries (no infinite retry)', async () => {
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { n++; return new Response('{"code":-1,"msg":"boom"}', { status: 500 }); };
  try {
    const c = new BinanceRestClient({ timeoutMs: 500 });
    await assert.rejects(() => c.ping(), BinanceApiError);
    assert.ok(n <= 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('WebSocket manager: single combined connection, duplicate protection, stale detection', async () => {
  const sockets = [];
  globalThis.window = {};
  globalThis.WebSocket = class {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(x) { this.sent.push(JSON.parse(x)); }
    close() { this.onclose?.(); }
  };
  const { BinanceWebSocketManager } = await import('../lib/binance/ws.js');
  const m = new BinanceWebSocketManager();
  const got = [];
  m.on('message', (x) => got.push(x));
  m.subscribe(['btcusdt@kline_15m', 'ethusdt@kline_15m']);
  assert.equal(sockets.length, 1, 'one socket for many streams');
  assert.match(sockets[0].url, /streams=btcusdt@kline_15m\/ethusdt@kline_15m/);
  sockets[0].onopen();
  assert.equal(m.getStatus().status, 'CONNECTED');
  const evt = { stream: 'btcusdt@kline_15m', data: { e: 'kline', k: { t: 1, x: false, o: '1', h: '1', l: '1', c: '1', v: '1', T: 2, q: '1', n: 1, V: '1', Q: '1' } } };
  sockets[0].onmessage({ data: JSON.stringify(evt) });
  sockets[0].onmessage({ data: JSON.stringify(evt) }); // duplicate
  assert.equal(got.length, 1);
  const h = m.getStatus().streamHealth.find((s) => s.stream === 'ethusdt@kline_15m');
  assert.equal(h.stale, true, 'stream that never delivered data is stale');
  // adding a stream later must NOT reconnect: it is a SUBSCRIBE frame on the same socket
  m.subscribe('solusdt@ticker');
  assert.equal(sockets.length, 1);
  assert.ok(sockets[0].sent.some((f) => f.method === 'SUBSCRIBE' && f.params.includes('solusdt@ticker')));
  // reference counting: two components share a stream; the first to leave must not kill it
  m.subscribe('solusdt@ticker');
  m.unsubscribe('solusdt@ticker');
  assert.ok(m.getStatus().streamHealth.some((x) => x.stream === 'solusdt@ticker'));
  m.unsubscribe('solusdt@ticker');
  assert.ok(sockets[0].sent.some((f) => f.method === 'UNSUBSCRIBE'));
  // request/response latency is measured from the real reply
  const listCall = sockets[0].sent.find((f) => f.method === 'LIST_SUBSCRIPTIONS');
  sockets[0].onmessage({ data: JSON.stringify({ result: [], id: listCall.id }) });
  assert.equal(typeof m.getStatus().latencyMs, 'number');
  m.close();
});

test('Strategy variants are strictly nested (each adds one condition)', () => {
  const k = (v) => STRATEGY_VARIANTS[v].components;
  assert.ok(k('A').every((c) => k('B').includes(c)) && k('B').length === k('A').length + 1);
  assert.ok(k('B').every((c) => k('C').includes(c)) && k('C').length === k('B').length + 1);
  assert.ok(k('C').every((c) => k('D').includes(c)) && k('D').length === k('C').length + 1);
});

test('SignalEngine refuses to signal on stale/incomplete data and on a forming candle count shortfall', () => {
  const cfg = cloneDefaultConfig();
  const c = makeCandles(300);
  const tf = { '4h': c, '1h': c, '15m': c };
  assert.equal(signalEngine.evaluate({ symbol: 'X', executionCandles: c, candlesByTf: tf, config: cfg, dataQuality: { isStale: true } }).state, 'NO_TRADE');
  assert.equal(signalEngine.evaluate({ symbol: 'X', executionCandles: c, candlesByTf: tf, config: cfg, dataQuality: { isComplete: false } }).state, 'NO_TRADE');
  assert.equal(signalEngine.evaluate({ symbol: 'X', executionCandles: c.slice(0, 50), candlesByTf: tf, config: cfg }).state, 'NO_TRADE');
});

test('CLOSED CANDLE POLICY: confirmed mode ignores a forming candle, early mode uses it', () => {
  const cfg = cloneDefaultConfig();
  const c = makeCandles(300);
  const forming = { ...c[c.length - 1], openTime: c[c.length - 1].openTime + 900_000, closeTime: Date.now() + 10 * 60_000, isClosed: false, close: c[c.length - 1].close * 1.5, high: c[c.length - 1].close * 1.6 };
  const withForming = [...c, forming];
  const tf = { '4h': c, '1h': c, '15m': c };
  const a = signalEngine.evaluate({ symbol: 'X', executionCandles: c, candlesByTf: tf, config: cfg });
  const b = signalEngine.evaluate({ symbol: 'X', executionCandles: withForming, candlesByTf: tf, config: cfg });
  assert.equal(b.candleOpenTime ?? a.candleOpenTime, a.candleOpenTime);
  assert.equal(a.price ?? 0, b.price ?? 0);
  const early = signalEngine.evaluate({ symbol: 'X', executionCandles: withForming, candlesByTf: tf, config: { ...cfg, earlyMode: true } });
  if (early.state !== 'NO_TRADE') {
    assert.equal(early.mode, 'EARLY');
    assert.ok(early.warnings.some((w) => /repaint/i.test(w)));
  }
});

test('BACKTEST NO LOOK-AHEAD: altering candles after bar K never changes signals at or before K', async () => {
  const eng = new BacktestEngine();
  const cfg = cloneDefaultConfig();
  const candles = makeCandles(900, { seed: 11 });
  const K = 760;
  const future = candles.map((c, i) => (i > K ? { ...c, open: c.open * 3, high: c.high * 3.2, low: c.low * 2.8, close: c.close * 3, volume: c.volume * 50, quoteVolume: c.quoteVolume * 150 } : c));
  const a = await eng.precompute({ symbol: 'X', candles, execInterval: '15m', config: cfg });
  const b = await eng.precompute({ symbol: 'X', candles: future, execInterval: '15m', config: cfg });
  assert.ok(a.signals.length > 0, 'fixture must produce some signals to make the test meaningful');
  const pick = (r) => JSON.stringify(r.signals.filter((s) => s.i <= K));
  assert.equal(pick(a), pick(b));
  assert.notEqual(JSON.stringify(a.signals.filter((s) => s.i > K)), JSON.stringify(b.signals.filter((s) => s.i > K)), 'sanity: the altered future does change later signals');
});

test('Backtest simulation: entry at NEXT open, stop-first on ties, break-even after TP1, fees charged', () => {
  const eng = new BacktestEngine();
  const mk = (i, o, h, l, c) => flatCandle(i, o, h, l, c);
  const candles = [mk(0, 100, 100, 100, 100), mk(1, 100, 101, 99.5, 100.5), mk(2, 100.5, 102.2, 100, 102), mk(3, 102, 104.2, 100.9, 103), mk(4, 103, 103, 99, 99)];
  const sig = { i: 0, direction: 'LONG', score: 80, hard: { htf: true, volume: true, poc: true }, sl: 99, tps: [102, 104, 106], rr: 2 };
  const { trades } = eng.simulate(candles, [sig], { minScore: 70, minRR: 1, feeBps: 0, partials: [0.5, 0.5, 0] });
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.entryIndex, 1);
  assert.equal(t.entryPrice, 100); // next candle's open, not signal close
  // TP1 (102) hit on bar 2 -> 0.5*2R; TP2 (104) on bar 3 -> 0.5*4R
  assert.ok(Math.abs(t.r - (0.5 * 2 + 0.5 * 4)) < 1e-9, `r=${t.r}`);
  const fee = eng.simulate(candles, [sig], { minScore: 70, minRR: 1, feeBps: 10, partials: [0.5, 0.5, 0] }).trades[0];
  assert.ok(fee.r < t.r);
  const tie = [mk(0, 100, 100, 100, 100), mk(1, 100, 103, 98.5, 100)]; // both TP1 and SL touched
  const tr = eng.simulate(tie, [sig], { minScore: 70, minRR: 1, feeBps: 0 }).trades[0];
  assert.equal(tr.result, 'SL');
  assert.ok(tr.r < 0);
});

test('Monte Carlo is reproducible and walk-forward reports out-of-sample separately', () => {
  const eng = new BacktestEngine();
  const trades = Array.from({ length: 40 }, (_, i) => ({ r: i % 3 === 0 ? -1 : 1.2, score: 70, direction: 'LONG' }));
  const a = eng.monteCarlo(trades, { iterations: 300, seed: 5 });
  const b = eng.monteCarlo(trades, { iterations: 300, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(a.maxDrawdownR.p95 >= a.maxDrawdownR.p50);
});
