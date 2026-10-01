import { atr as atrFn } from '../indicators';

/**
 * MarketStructureEngine (v2)
 * -----------------------------------------------------------------------
 * Fully causal: a swing is only "known" `swingRightBars` candles after it
 * formed, and a structure break is only registered when a candle CLOSES
 * beyond the level of the last known, unbroken swing. Nothing here looks
 * at candles after the one being processed.
 *
 * Outputs
 *  - swings labelled HH / HL / LH / LL (minor structure)
 *  - major swings using a window 2.5x wider (major structure)
 *  - BOS / CHOCH events (close-based) with the exact broken swing
 *  - RETEST events (price returns to a broken level and holds)
 *  - LIQUIDITY_SWEEP events (wick beyond an unbroken swing, close back inside)
 *  - regime (TREND_BULLISH / TREND_BEARISH / RANGE) and volatility phase
 */

export const StructureConfig = {
  swingLeftBars: 3,
  swingRightBars: 3,
  minimumSwingDistancePct: 0.05,
  atrFilterMultiplier: 0,
  retestTolerancePct: 0.25,
  retestWindowBars: 30,
  majorMultiplier: 2.5,
};

function findSwings(candles, left, right) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      // strict on the left, non-strict on the right => avoids duplicate equal pivots
      if (j < i ? candles[j].high >= candles[i].high : candles[j].high > candles[i].high) isHigh = false;
      if (j < i ? candles[j].low <= candles[i].low : candles[j].low < candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ index: i, confirmedAt: i + right, price: candles[i].high, openTime: candles[i].openTime });
    if (isLow) lows.push({ index: i, confirmedAt: i + right, price: candles[i].low, openTime: candles[i].openTime });
  }
  return { highs, lows };
}

function filterSwings(swings, cfg, atrSeries) {
  if (swings.length < 2) return swings;
  const out = [swings[0]];
  for (const cur of swings.slice(1)) {
    const prev = out[out.length - 1];
    const dist = Math.abs(cur.price - prev.price);
    if ((dist / prev.price) * 100 < cfg.minimumSwingDistancePct) continue;
    if (cfg.atrFilterMultiplier > 0) {
      const a = atrSeries[cur.index];
      if (a && dist < a * cfg.atrFilterMultiplier) continue;
    }
    out.push(cur);
  }
  return out;
}

function label(highs, lows) {
  return {
    highs: highs.map((h, i) => ({ ...h, label: i === 0 ? 'SWING_HIGH' : h.price > highs[i - 1].price ? 'HH' : 'LH' })),
    lows: lows.map((l, i) => ({ ...l, label: i === 0 ? 'SWING_LOW' : l.price > lows[i - 1].price ? 'HL' : 'LL' })),
  };
}

function walk(candles, highs, lows, cfg) {
  const events = [];
  let trend = 'NEUTRAL';
  let liveHigh = null; // last confirmed, unbroken swing high
  let liveLow = null;
  const pendingRetests = [];
  const tol = cfg.retestTolerancePct / 100;

  const highQueue = [...highs];
  const lowQueue = [...lows];

  for (let i = 0; i < candles.length; i++) {
    // reveal swings that have just become confirmed
    while (highQueue.length && highQueue[0].confirmedAt <= i) liveHigh = highQueue.shift();
    while (lowQueue.length && lowQueue[0].confirmedAt <= i) liveLow = lowQueue.shift();
    const c = candles[i];

    // retest tracking of previously broken levels
    for (const r of pendingRetests) {
      if (r.done || i <= r.breakIndex) continue;
      if (i - r.breakIndex > cfg.retestWindowBars) {
        r.done = true;
        continue;
      }
      if (r.direction === 'BULLISH' && c.low <= r.level * (1 + tol) && c.close > r.level) {
        events.push({ type: 'RETEST', direction: 'BULLISH', index: i, price: r.level, of: r.type });
        r.done = true;
      } else if (r.direction === 'BEARISH' && c.high >= r.level * (1 - tol) && c.close < r.level) {
        events.push({ type: 'RETEST', direction: 'BEARISH', index: i, price: r.level, of: r.type });
        r.done = true;
      }
    }

    if (liveHigh) {
      if (c.close > liveHigh.price) {
        const type = trend === 'BEARISH' ? 'CHOCH' : 'BOS';
        events.push({ type, direction: 'BULLISH', index: i, price: liveHigh.price, brokenSwing: liveHigh });
        pendingRetests.push({ direction: 'BULLISH', level: liveHigh.price, breakIndex: i, type, done: false });
        trend = 'BULLISH';
        liveHigh = null;
      } else if (c.high > liveHigh.price && c.close < liveHigh.price) {
        events.push({ type: 'LIQUIDITY_SWEEP', direction: 'BEARISH', index: i, price: liveHigh.price });
      }
    }
    if (liveLow) {
      if (c.close < liveLow.price) {
        const type = trend === 'BULLISH' ? 'CHOCH' : 'BOS';
        events.push({ type, direction: 'BEARISH', index: i, price: liveLow.price, brokenSwing: liveLow });
        pendingRetests.push({ direction: 'BEARISH', level: liveLow.price, breakIndex: i, type, done: false });
        trend = 'BEARISH';
        liveLow = null;
      } else if (c.low < liveLow.price && c.close > liveLow.price) {
        events.push({ type: 'LIQUIDITY_SWEEP', direction: 'BULLISH', index: i, price: liveLow.price });
      }
    }
  }
  return { events, trend };
}

function regimeOf(highs, lows, trend) {
  if (highs.length < 2 || lows.length < 2) return 'RANGE';
  const h = highs.slice(-2);
  const l = lows.slice(-2);
  const hh = h[1].price > h[0].price;
  const hl = l[1].price > l[0].price;
  if (hh && hl) return 'TREND_BULLISH';
  if (!hh && !hl) return 'TREND_BEARISH';
  // mixed swings: defer to the last structural break, else range
  if (trend === 'BULLISH' && hl) return 'TREND_BULLISH';
  if (trend === 'BEARISH' && !hh) return 'TREND_BEARISH';
  return 'RANGE';
}

function volatilityPhase(atrSeries) {
  const v = atrSeries.filter((x) => typeof x === 'number');
  if (v.length < 25) return 'UNKNOWN';
  const recent = v.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const base = v.slice(-25, -5).reduce((a, b) => a + b, 0) / 20;
  if (!base) return 'UNKNOWN';
  const ratio = recent / base;
  return ratio > 1.25 ? 'EXPANSION' : ratio < 0.75 ? 'CONTRACTION' : 'STABLE';
}

export class MarketStructureEngine {
  constructor(config = {}) {
    this.config = { ...StructureConfig, ...config };
  }

  _analyzeAt(candles, left, right, atrSeries) {
    const raw = findSwings(candles, left, right);
    const hs = filterSwings(raw.highs, this.config, atrSeries);
    const ls = filterSwings(raw.lows, this.config, atrSeries);
    const { highs, lows } = label(hs, ls);
    const { events, trend } = walk(candles, highs, lows, this.config);
    return { highs, lows, events, trend, regime: regimeOf(highs, lows, trend) };
  }

  analyze(candles) {
    const { swingLeftBars: L, swingRightBars: R, majorMultiplier } = this.config;
    if (candles.length < L + R + 10) {
      return { ready: false, reason: 'INSUFFICIENT_CANDLES', highs: [], lows: [], events: [], trend: 'NEUTRAL', regime: 'UNKNOWN', volatilityPhase: 'UNKNOWN' };
    }
    const atrSeries = atrFn(candles, 14);
    const minor = this._analyzeAt(candles, L, R, atrSeries);
    const major = this._analyzeAt(candles, Math.round(L * majorMultiplier), Math.round(R * majorMultiplier), atrSeries);

    const structureEvents = minor.events.filter((e) => e.type === 'BOS' || e.type === 'CHOCH');
    const lastEvent = structureEvents[structureEvents.length - 1] || null;
    const lastRetest = [...minor.events].reverse().find((e) => e.type === 'RETEST') || null;
    const lastSweep = [...minor.events].reverse().find((e) => e.type === 'LIQUIDITY_SWEEP') || null;
    const lastIdx = candles.length - 1;

    return {
      ready: true,
      highs: minor.highs,
      lows: minor.lows,
      events: minor.events,
      trend: minor.trend,
      regime: minor.regime,
      major: { trend: major.trend, regime: major.regime, highs: major.highs, lows: major.lows, events: major.events },
      volatilityPhase: volatilityPhase(atrSeries),
      lastEvent,
      lastRetest,
      lastSweep,
      recentRetest: !!lastRetest && lastIdx - lastRetest.index <= 3,
      recentSweep: !!lastSweep && lastIdx - lastSweep.index <= 3,
      lastMajorHigh: (major.highs[major.highs.length - 1]) || minor.highs[minor.highs.length - 1] || null,
      lastMajorLow: (major.lows[major.lows.length - 1]) || minor.lows[minor.lows.length - 1] || null,
      lastMinorHigh: minor.highs[minor.highs.length - 1] || null,
      lastMinorLow: minor.lows[minor.lows.length - 1] || null,
    };
  }
}

export const marketStructureEngine = new MarketStructureEngine();
