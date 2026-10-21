import test from 'node:test';
import assert from 'node:assert/strict';
import { signalEngine, SignalEngine, EntryType, SignalState } from '../lib/signals/signalEngine.js';
import { cloneDefaultConfig } from '../lib/config/strategyConfig.js';
import { makeCandles, flatCandle } from './fixtures.mjs';

// These tests call the engine's internal _entry() directly with a hand-built
// ctx/structure/vp, rather than coaxing the full swing-detection pipeline
// into an exact scenario — the point here is the ENTRY ARCHETYPE LOGIC
// itself (the user's core complaint: "Entry == Current Price"), not the
// structure/volume-profile engines, which already have their own tests.

function baseCtx(overrides = {}) {
  return {
    config: cloneDefaultConfig(),
    structure: { lastEvent: null, lows: [], highs: [], lastMinorLow: null, lastMinorHigh: null },
    vp: { poc: { price: 100 }, vah: 102, val: 98, hvn: [] },
    price: 100,
    atrValue: 1,
    ...overrides,
  };
}

const candlesUpTo = (n, close) => Array.from({ length: n }, (_, i) => flatCandle(i, close, close, close, close));

test('Entry is NEVER silently equal to current price in AUTO mode when a genuine retest level exists far from price', () => {
  const eng = new SignalEngine();
  const exec = candlesUpTo(50, 100);
  const ctx = baseCtx({
    price: 103.5, // price has run up well away from the broken level
    structure: {
      lastEvent: { type: 'BOS', direction: 'BULLISH', index: 10, price: 100 }, // broke out 40 candles ago -> not "fresh"
      lows: [{ price: 97 }], highs: [{ price: 101 }],
      lastMinorLow: { price: 97 }, lastMinorHigh: { price: 101 },
    },
    vp: { poc: { price: 99 }, vah: 100.5, val: 96, hvn: [] },
  });
  const entry = eng._entry('LONG', ctx, exec[exec.length - 1], exec);
  assert.notEqual(entry.price, ctx.price, 'computed entry must differ from the live price when price has run away from any logical level');
  assert.ok(entry.price < ctx.price, 'the entry zone must be BELOW the extended current price for a LONG pullback');
  assert.equal(entry.pending, true, 'price has not reached this zone yet -> must be flagged pending (WAITING FOR RETEST)');
  assert.ok(entry.rationale.length > 10, 'must explain itself in plain language');
});

test('A fresh breakout with no pullback yet legitimately enters near the current price, and says so explicitly', () => {
  const eng = new SignalEngine();
  const exec = candlesUpTo(50, 100);
  const ctx = baseCtx({
    price: 100.2, // still right at the break level
    structure: {
      lastEvent: { type: 'BOS', direction: 'BULLISH', index: exec.length - 1, price: 100 }, // broke out on the last candle
      lows: [{ price: 97 }], highs: [{ price: 100 }],
      lastMinorLow: { price: 97 }, lastMinorHigh: { price: 100 },
    },
  });
  const entry = eng._entry('LONG', ctx, exec[exec.length - 1], exec);
  assert.equal(entry.type, EntryType.BREAKOUT_ENTRY);
  assert.ok(!entry.pending, 'a legitimate immediate breakout entry is not "pending"');
  assert.ok(Math.abs(entry.price - ctx.price) < 1, 'breakout entry should be near (not far from) the current price, by design');
});

test('Price currently retesting the POC/VAH produces a retest entry anchored at that real level, not an arbitrary number', () => {
  const eng = new SignalEngine();
  const exec = candlesUpTo(50, 100);
  const ctx = baseCtx({
    price: 99.9, // sitting right on the POC
    vp: { poc: { price: 99.8 }, vah: 103, val: 96, hvn: [] },
    structure: { lastEvent: null, lows: [{ price: 95 }], highs: [{ price: 103 }], lastMinorLow: { price: 95 }, lastMinorHigh: { price: 103 } },
  });
  const entry = eng._entry('LONG', ctx, exec[exec.length - 1], exec);
  assert.equal(entry.type, EntryType.POC_RETEST_ENTRY);
  assert.equal(entry.price, 99.8, 'entry must be anchored to the real POC value, not a guess');
});

test('SHORT direction mirrors LONG: entry zone sits ABOVE an extended price, anchored at a real resistance/VAH level', () => {
  const eng = new SignalEngine();
  const exec = candlesUpTo(50, 100);
  const ctx = baseCtx({
    price: 96.5,
    vp: { poc: { price: 99 }, vah: 101, val: 97.5, hvn: [] },
    structure: {
      lastEvent: { type: 'BOS', direction: 'BEARISH', index: 10, price: 100 },
      lows: [{ price: 96 }], highs: [{ price: 100 }],
      lastMinorLow: { price: 96 }, lastMinorHigh: { price: 100 },
    },
  });
  const entry = eng._entry('SHORT', ctx, exec[exec.length - 1], exec);
  assert.ok(entry.price > ctx.price, 'SHORT retest entry must be ABOVE the extended (lower) current price');
});

test('Manual MARKET override still works and is explicitly labeled MARKET_ENTRY', () => {
  const eng = new SignalEngine();
  const exec = candlesUpTo(50, 100);
  const cfg = cloneDefaultConfig();
  cfg.entryMode = 'MARKET';
  const ctx = baseCtx({ config: cfg, price: 105 });
  const entry = eng._entry('LONG', ctx, exec[exec.length - 1], exec);
  assert.equal(entry.type, EntryType.MARKET_ENTRY);
  assert.equal(entry.price, 105);
});

test('MACD scoring: bullish cross + rising histogram scores full weight for LONG, half for SHORT-wrong-direction gets zero', () => {
  // Hand-constructed indicator values so the scoring LOGIC is tested in
  // isolation from indicator-computation nuances (those have their own
  // dedicated tests in indicators.test.mjs). macdLine > signalLine (bullish
  // cross) and histogram rising (0.4 -> 0.6) is an unambiguous "confirmed
  // bullish momentum" case for LONG, and its mirror image for SHORT.
  const eng = new SignalEngine();
  const cfg = cloneDefaultConfig();
  cfg.strategyVariant = 'FULL';
  const baseCtxFor = (indicators, histogramSeries) => ({
    structure: { regime: 'TREND_BULLISH', major: { trend: 'BULLISH' }, lastEvent: null, recentRetest: false },
    volume: { ready: false }, vp: {}, pocInteraction: {}, priceAction: { ready: false, patterns: [] },
    indicators, macd: { histogram: histogramSeries }, price: 100, config: cfg,
  });

  const bullish = baseCtxFor({ macdLine: 0.6, macdSignal: 0.2, macdHistogram: 0.6, macdReady: true }, [0.3, 0.4, 0.6]);
  const long = eng._evaluateDirection('LONG', bullish);
  const shortOnBullish = eng._evaluateDirection('SHORT', bullish);
  assert.equal(long.breakdown.macd, cfg.weights.macd, 'confirmed bullish cross + rising histogram -> full MACD weight for LONG');
  assert.equal(shortOnBullish.breakdown.macd, 0, 'a bullish MACD state must score zero for SHORT');
  assert.ok(long.reasons.some((r) => /MACD confirms bullish/.test(r)));

  const bearish = baseCtxFor({ macdLine: -0.6, macdSignal: -0.2, macdHistogram: -0.6, macdReady: true }, [-0.3, -0.4, -0.6]);
  const short = eng._evaluateDirection('SHORT', bearish);
  assert.equal(short.breakdown.macd, cfg.weights.macd, 'confirmed bearish cross + falling histogram -> full MACD weight for SHORT');

  // Cross is in our favor but momentum has stalled (histogram flat) -> partial credit, not full.
  const stalled = baseCtxFor({ macdLine: 0.6, macdSignal: 0.2, macdHistogram: 0.5, macdReady: true }, [0.5, 0.5, 0.5]);
  const partial = eng._evaluateDirection('LONG', stalled);
  assert.equal(partial.breakdown.macd, cfg.weights.macd * 0.5);
});

test('MACD NOT_READY on a short series is reported as a warning, never fabricated', () => {
  const eng = new SignalEngine();
  const cfg = cloneDefaultConfig();
  const ctx = {
    structure: { regime: 'RANGE', major: {}, lastEvent: null },
    volume: { ready: false }, vp: {}, pocInteraction: {}, priceAction: { ready: false, patterns: [] },
    indicators: { macdReady: false },
    macd: { histogram: [null] },
    price: 100, config: cfg,
  };
  const long = eng._evaluateDirection('LONG', ctx);
  assert.equal(long.breakdown.macd, 0);
  assert.ok(long.warnings.some((w) => /MACD is NOT_READY/.test(w)));
});

test('evaluate(): DATA UNAVAILABLE is reported verbatim (not an invented result) when data is stale, incomplete, or disconnected', () => {
  const cfg = cloneDefaultConfig();
  const c = makeCandles(300);
  const tf = { '4h': c, '1h': c, '15m': c };
  const stale = signalEngine.evaluate({ symbol: 'X', executionCandles: c, candlesByTf: tf, config: cfg, dataQuality: { isStale: true } });
  const incomplete = signalEngine.evaluate({ symbol: 'X', executionCandles: c, candlesByTf: tf, config: cfg, dataQuality: { isComplete: false } });
  const disconnected = signalEngine.evaluate({ symbol: 'X', executionCandles: c, candlesByTf: tf, config: cfg, dataQuality: { state: 'DISCONNECTED' } });
  for (const r of [stale, incomplete, disconnected]) {
    assert.equal(r.state, SignalState.NO_TRADE);
    assert.equal(r.failedConditions[0].code, 'DATA_UNAVAILABLE');
  }
});

test('evaluate(): a CANDIDATE whose entry zone has not been reached yet is never promoted to CONFIRMED', () => {
  // Minimal end-to-end sanity check on the hard.entryReached gate, using the
  // real evaluate() pipeline so this also exercises the full wiring, not
  // just _entry() in isolation.
  const cfg = cloneDefaultConfig();
  const exec = Array.from({ length: 400 }, (_, i) => {
    const c = 100 + Math.sin(i / 11) * 2 + i * 0.05;
    return flatCandle(i, c, c + 0.3, c - 0.3, c, 100 + (i % 13 === 0 ? 300 : 0));
  });
  const tf = { '1d': exec, '4h': exec, '15m': exec };
  const result = signalEngine.evaluate({ symbol: 'TEST', executionCandles: exec, candlesByTf: tf, config: cfg, dataQuality: { isStale: false, isComplete: true } });
  if (result.plan?.entryPending) {
    assert.notEqual(result.state, `${result.direction}_CONFIRMED`, 'a pending (not-yet-reached) entry zone must never be CONFIRMED');
  }
});

test('No fabricated market/signal data: Math.random() appears ONLY in the two documented retry/reconnect-jitter spots, nowhere else', async () => {
  // Point 10 of the spec bans random/fake PRICES, INDICATORS, VOLUME and
  // SIGNALS — it does not (and could not reasonably) ban randomized retry
  // backoff jitter, which is standard practice and touches no market data.
  // Rather than a blanket ban that would also flag that legitimate case,
  // this allowlists exactly the two known, commented, reviewed jitter call
  // sites and fails on any OTHER appearance — new code is still held to the
  // "no fake data" rule, with no silent exceptions beyond these two.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');
  const ALLOWED = new Set([path.join(root, 'lib/binance/rest.js'), path.join(root, 'lib/binance/ws.js')]);
  const offenders = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.next' || entry === 'tests') continue;
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs)$/.test(entry)) {
        const content = readFileSync(full, 'utf8');
        if (/Math\.random\s*\(/.test(content) && !ALLOWED.has(full)) offenders.push(full);
      }
    }
  }
  for (const d of ['lib', 'app', 'components']) walk(path.join(root, d));
  assert.deepEqual(offenders, [], `Unexpected Math.random() found in: ${offenders.join(', ')}`);

  // And confirm the two allowed spots are still exactly what they claim to
  // be: retry/backoff jitter, each with its own "this is jitter, not data"
  // comment right above the call, so a future edit can't quietly repurpose them.
  for (const file of ALLOWED) {
    const content = readFileSync(file, 'utf8');
    assert.match(content, /jitter[\s\S]{0,400}Math\.random\(\)/i, `${file} must keep an explanatory jitter comment directly above its Math.random() call`);
  }
});
