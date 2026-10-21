import { marketStructureEngine } from '../structure/structureEngine';
import { volumeEngine } from '../volume/volumeEngine';
import { volumeProfileEngine } from '../volumeProfile/volumeProfileEngine';
import { priceActionEngine } from '../priceAction/priceActionEngine';
import { mtfEngine } from '../mtf/mtfEngine';
import { riskEngine } from '../risk/riskEngine';
import { rsi, atr, emaSet, macd, lastReady } from '../indicators';
import { onlyClosed } from '../data/candle';
import { DEFAULT_STRATEGY_CONFIG } from '../config/strategyConfig';

export const SignalState = Object.freeze({
  WAIT: 'WAIT',
  WATCH: 'WATCH',
  LONG_CANDIDATE: 'LONG_CANDIDATE',
  LONG_CONFIRMED: 'LONG_CONFIRMED',
  SHORT_CANDIDATE: 'SHORT_CANDIDATE',
  SHORT_CONFIRMED: 'SHORT_CONFIRMED',
  INVALIDATED: 'INVALIDATED',
  EXPIRED: 'EXPIRED',
  NO_TRADE: 'NO_TRADE',
});

/**
 * Entry archetypes SignalEngine#_entry() can produce. Every one is an
 * explicit label shown in the UI next to the Entry Zone — "Entry" is
 * never silently equal to the live price without saying so.
 */
export const EntryType = Object.freeze({
  MARKET_ENTRY: 'MARKET_ENTRY', // genuinely entering at/near the current price, explicitly
  BREAKOUT_ENTRY: 'BREAKOUT_ENTRY', // fresh break, no pullback yet — entering near the break
  RETEST_ENTRY: 'RETEST_ENTRY', // waiting for / currently at a pullback to a broken structural level
  POC_RETEST_ENTRY: 'POC_RETEST_ENTRY', // waiting for / currently at a pullback to the POC
  VALUE_AREA_RETEST_ENTRY: 'VALUE_AREA_RETEST_ENTRY', // waiting for / currently at VAH/VAL
  SWING_BREAK_ENTRY: 'SWING_BREAK_ENTRY', // manual override: enter on a swing-level break
});

/**
 * Strategy variants (spec section 40). Each variant enables a subset of
 * score components so the backtester can measure what every extra
 * condition actually adds. The score is re-normalised to 0..100 over the
 * enabled components. Multi-timeframe alignment is intentionally absent
 * here — see the `weights` comment in strategyConfig.js for why.
 */
export const STRATEGY_VARIANTS = {
  A: { label: 'Structure + POC', components: ['marketStructure', 'poc'] },
  B: { label: 'Structure + POC + Volume', components: ['marketStructure', 'poc', 'volume'] },
  C: { label: 'Structure + POC + Volume + EMA + RSI', components: ['marketStructure', 'poc', 'volume', 'ema', 'rsi'] },
  D: {
    label: 'Structure + POC + Volume + EMA + RSI + MACD + Breakout/Retest',
    components: ['marketStructure', 'poc', 'volume', 'ema', 'rsi', 'macd', 'priceAction'],
  },
  FULL: {
    label: 'All components',
    components: ['marketStructure', 'poc', 'volume', 'ema', 'rsi', 'macd', 'priceAction', 'atrRisk'],
  },
};

function weightOf(config, component) {
  return config.weights[component] ?? 0;
}

/**
 * SignalEngine — deterministic, rule-based, fully explained. It never
 * returns a directional state without the reasons, failed conditions and
 * warnings that produced it (NO BLACK BOX), and it never reports a
 * computed Entry Zone that is secretly just "whatever the price is right
 * now" without saying so via `plan.entryType`.
 */
export class SignalEngine {
  evaluate({ symbol, executionCandles, candlesByTf, config = DEFAULT_STRATEGY_CONFIG, dataQuality = {} }) {
    const earlyMode = !!config.earlyMode;
    const closedPolicy = !earlyMode;

    if (dataQuality.state === 'DISCONNECTED' || dataQuality.state === 'DATA_ERROR') {
      return this._noTrade(symbol, config, 'DATA_UNAVAILABLE', ['Binance data unavailable']);
    }
    if (dataQuality.isStale) return this._noTrade(symbol, config, 'DATA_UNAVAILABLE', ['Live data is stale']);
    if (dataQuality.isComplete === false) {
      return this._noTrade(symbol, config, 'DATA_UNAVAILABLE', ['Historical data has unresolved gaps']);
    }

    // CLOSED CANDLE POLICY: confirmed mode never sees a forming candle.
    const exec = closedPolicy ? onlyClosed(executionCandles || []) : executionCandles || [];
    const tfs = {};
    for (const [tf, cs] of Object.entries(candlesByTf || {})) tfs[tf] = closedPolicy ? onlyClosed(cs) : cs;

    if (exec.length < 120) {
      return this._noTrade(symbol, config, 'INSUFFICIENT_CANDLES', ['Not enough closed candles for reliable analysis']);
    }

    const last = exec[exec.length - 1];
    const currentPrice = last.close; // the REAL, live reference price — never silently relabeled "Entry"

    const structure = marketStructureEngine.analyze(exec);
    if (!structure.ready) return this._noTrade(symbol, config, 'STRUCTURE_NOT_READY', ['Market structure not established']);

    const vp = volumeProfileEngine.build(exec.slice(-200), config.volumeProfile);
    if (!vp.ready) return this._noTrade(symbol, config, 'VOLUME_PROFILE_NOT_READY', ['Volume profile could not be built']);
    const prevVp = exec.length >= 320 ? volumeProfileEngine.build(exec.slice(-320, -120), config.volumeProfile) : null;
    const pocInteraction = volumeProfileEngine.classifyPocInteraction(currentPrice, vp.poc, prevVp?.ready ? prevVp.poc : null);

    const volume = volumeEngine.analyze(exec);
    const priceAction = priceActionEngine.analyze(exec, {
      poc: vp.poc,
      support: structure.lastMinorLow?.price,
      resistance: structure.lastMinorHigh?.price,
    });
    const mtf = mtfEngine.analyze(tfs);

    const rsiValue = lastReady(rsi(exec, config.rsi.period));
    const atrValue = lastReady(atr(exec, 14));
    const emas = emaSet(exec);
    const ema20 = lastReady(emas.ema20);
    const ema50 = lastReady(emas.ema50);
    const macdResult = macd(exec);
    const mi = macdResult.histogram.length - 1;
    const indicators = {
      rsi: rsiValue,
      rsiReady: typeof rsiValue === 'number',
      atr: atrValue,
      ema20,
      ema50,
      macdLine: macdResult.macdLine[mi],
      macdSignal: macdResult.signalLine[mi],
      macdHistogram: macdResult.histogram[mi],
      macdReady: typeof macdResult.histogram[mi] === 'number' && typeof macdResult.histogram[mi - 1] === 'number',
    };

    const atrPct = atrValue ? (atrValue / currentPrice) * 100 : null;
    const gate = this._marketGates({ config, volume, atrPct, mtf, dataQuality });
    if (gate) {
      return this._noTrade(symbol, config, gate.code, [gate.reason], { structure, volumeProfile: vp, mtf, volume, indicators, currentPrice, price: currentPrice });
    }

    const ctx = { structure, volume, vp, pocInteraction, priceAction, mtf, indicators, macd: macdResult, price: currentPrice, config, atrValue };
    const longEval = this._evaluateDirection('LONG', ctx);
    const shortEval = this._evaluateDirection('SHORT', ctx);
    const direction = longEval.score >= shortEval.score ? 'LONG' : 'SHORT';
    const best = direction === 'LONG' ? longEval : shortEval;

    // --- ENTRY ZONE: computed from real analysis, never silently = current price ---
    const entryInfo = this._entry(direction, ctx, last, exec);
    const structureTargets = this._structureTargets(direction, currentPrice, structure, vp);
    const plan = riskEngine.fullPlan(direction, entryInfo.price, {
      structure,
      atr: atrValue,
      method: config.stopMethod || 'STRUCTURE_ATR',
      atrMultiplier: config.atrMultiplier,
      accountSize: config.accountSize,
      riskPercent: config.riskPercent,
      rMultiples: config.rMultiples || [1, 2, 3],
      structureTargets,
    });
    plan.entryZone = entryInfo.zone;
    plan.entryType = entryInfo.type;
    plan.entryPending = !!entryInfo.pending;
    plan.entryRationale = entryInfo.rationale;
    plan.confirmationCandleTime = last.openTime;
    // plan.entry (set by riskEngine.fullPlan) and plan.stopLoss/tp1/tp2/tp3 below
    // are the only numbers that matter for execution — currentPrice is reported
    // separately and is NEVER used as the trade's entry unless entryType says so.

    const rr = plan.riskRewardToTp1;
    const nextObstacle = structureTargets[0];
    let roomR = null;
    if (nextObstacle && plan.riskDistance > 0) roomR = Math.abs(nextObstacle - entryInfo.price) / plan.riskDistance;

    let atrRiskScore = 0;
    const wRisk = weightOf(config, 'atrRisk');
    if (typeof rr === 'number') {
      if (rr >= config.minRR) {
        atrRiskScore = wRisk;
        best.reasons.push(`Risk/Reward to TP1 acceptable (1:${rr.toFixed(2)})`);
      } else {
        atrRiskScore = wRisk * Math.max(0, rr / config.minRR) * 0.5;
        best.failedConditions.push(`Risk/Reward 1:${rr.toFixed(2)} below minimum 1:${config.minRR}`);
      }
    }
    if (roomR !== null && roomR < 1.2) {
      atrRiskScore *= 0.5;
      best.warnings.push('Next structure/POC level is very close to entry (limited room)');
    }
    const variantOn = (STRATEGY_VARIANTS[config.strategyVariant || 'FULL'] || STRATEGY_VARIANTS.FULL).components.includes('atrRisk');
    best.breakdown.atrRisk = variantOn ? atrRiskScore : 0;
    best.score = this._normalizeScore(Object.values(best.breakdown).reduce((a, b) => a + b, 0), config);

    const hard = {
      htf: !config.requireHTFAlignment || mtf.alignmentScore >= 0.66,
      volume: !config.requireVolumeConfirmation || best.flags.volumeOk,
      poc: !config.requirePOCInteraction || best.flags.pocOk,
      rr: typeof rr === 'number' && rr >= config.minRR,
      closed: closedPolicy ? last.isClosed !== false : true,
      entryReached: !entryInfo.pending,
    };
    const allHard = Object.values(hard).every(Boolean);

    let state;
    if (best.score < 35) state = SignalState.WAIT;
    else if (best.score < config.minScore) state = SignalState.WATCH;
    else if (allHard) state = direction === 'LONG' ? SignalState.LONG_CONFIRMED : SignalState.SHORT_CONFIRMED;
    else state = direction === 'LONG' ? SignalState.LONG_CANDIDATE : SignalState.SHORT_CANDIDATE;

    if (!hard.htf) best.failedConditions.push('Higher-timeframe alignment requirement not met');
    if (!hard.volume) best.failedConditions.push('Volume confirmation requirement not met');
    if (!hard.poc) best.failedConditions.push('POC interaction requirement not met');
    if (!hard.entryReached) best.failedConditions.push('Price has not yet reached the Entry Zone — waiting for retest');
    if (earlyMode) best.warnings.unshift('EARLY MODE: signal may repaint before the candle closes');

    return {
      symbol,
      state,
      direction,
      mode: earlyMode ? 'EARLY' : 'CONFIRMED',
      score: Math.round(best.score),
      scoreBreakdown: best.breakdown,
      reasons: best.reasons,
      warnings: best.warnings,
      failedConditions: best.failedConditions,
      currentPrice,
      price: currentPrice, // kept for backward compatibility with existing callers; prefer `currentPrice`
      plan,
      roomToTargetR: roomR,
      hard,
      structure,
      volume,
      volumeProfile: vp,
      pocInteraction,
      priceAction,
      mtf,
      indicators,
      atrPct,
      strategyVersion: config.version,
      strategyVariant: config.strategyVariant || 'FULL',
      timestamp: Date.now(),
      candleOpenTime: last.openTime,
      dataUsedUntil: last.closeTime,
      timeframe: config.timeframes?.mtf,
      disclaimer: 'Analytical signal only — not a guarantee of profit and not financial advice.',
      disclaimerAr: 'هذه الإشارات تحليلية وليست ضمانًا للربح ولا توصية مالية.',
    };
  }

  _marketGates({ config, volume, atrPct, mtf, dataQuality }) {
    const g = config.gates || {};
    if (dataQuality.spreadPct != null && dataQuality.spreadPct > (g.maxSpreadPct ?? 0.15)) {
      return { code: 'SPREAD_TOO_WIDE', reason: `Spread ${dataQuality.spreadPct.toFixed(3)}% is too wide` };
    }
    if (atrPct != null && atrPct > (g.maxAtrPct ?? 8)) {
      return { code: 'EXTREME_VOLATILITY', reason: `ATR is ${atrPct.toFixed(2)}% of price (extreme volatility)` };
    }
    if (atrPct != null && atrPct < (g.minAtrPct ?? 0.03)) {
      return { code: 'MARKET_TOO_QUIET', reason: `ATR is only ${atrPct.toFixed(3)}% of price (range too tight)` };
    }
    if (volume.ready && typeof volume.lastRelativeVolume === 'number' && volume.lastRelativeVolume < (g.minRelVolume ?? 0.25)) {
      return { code: 'WEAK_VOLUME', reason: `Relative volume ${volume.lastRelativeVolume.toFixed(2)}x is too weak` };
    }
    const biases = Object.values(mtf.perTimeframe).map((x) => x.bias);
    if (biases.includes('BULLISH') && biases.includes('BEARISH') && mtf.alignmentScore < 0.5) {
      return { code: 'CONFLICTING_TIMEFRAMES', reason: 'Timeframes point in opposite directions' };
    }
    return null;
  }

  _normalizeScore(score, config) {
    const variant = STRATEGY_VARIANTS[config.strategyVariant || 'FULL'] || STRATEGY_VARIANTS.FULL;
    const maxPossible = variant.components.reduce((a, c) => a + weightOf(config, c), 0) || 100;
    return Math.min(100, (score / maxPossible) * 100);
  }

  /**
   * Computes a real Entry Zone from structure / Volume Profile / retest
   * analysis. "Entry" is ONLY ever set equal to the live price when that
   * is genuinely what the analysis found (a fresh breakout with no
   * pullback yet, or an explicit manual Market Entry override) — and
   * either way, `type` says exactly which case it is. Nothing here picks
   * VAH/POC/VAL as the entry automatically; they are only used as the
   * anchor for a retest zone when price action actually supports that
   * read (a recent break of that level, or price currently sitting near
   * it) — see `rationale` on the returned object for the "why" in plain
   * language, same spirit as every other engine's `reasons`.
   */
  _entry(direction, ctx, last, exec) {
    const { config, structure, vp, price, atrValue } = ctx;
    const isLong = direction === 'LONG';
    const atrV = atrValue || price * 0.002;
    const mode = config.entryMode || 'AUTO';

    // --- Manual override modes: explicit, unchanged from the user's choice ---
    if (mode === 'MARKET') {
      const buf = atrV * 0.1;
      return {
        price,
        type: EntryType.MARKET_ENTRY,
        zone: { low: price - buf, high: price + buf },
        rationale: 'Manual override (Entry Mode = Market): entering at the current price regardless of retest.',
      };
    }
    if (mode === 'POC_RETEST') {
      const buf = atrV * 0.25;
      return {
        price: vp.poc.price,
        type: EntryType.POC_RETEST_ENTRY,
        zone: { low: vp.poc.price - buf, high: vp.poc.price + buf },
        pending: isLong ? price > vp.poc.price + buf : price < vp.poc.price - buf,
        rationale: 'Manual override (Entry Mode = POC Retest): entry anchored to the Point of Control.',
      };
    }
    if (mode === 'BREAKOUT') {
      const entry = isLong ? last.high + atrV * 0.05 : last.low - atrV * 0.05;
      const buf = atrV * 0.15;
      return {
        price: entry,
        type: EntryType.BREAKOUT_ENTRY,
        zone: { low: entry - buf, high: entry + buf },
        rationale: 'Manual override (Entry Mode = Breakout): entry set just beyond the confirmation candle\u2019s extreme.',
      };
    }
    if (mode === 'SWING_CONFIRM') {
      const lvl = isLong ? structure.lastMinorHigh?.price : structure.lastMinorLow?.price;
      if (lvl) {
        const buf = atrV * 0.15;
        return {
          price: lvl,
          type: EntryType.SWING_BREAK_ENTRY,
          zone: { low: lvl - buf, high: lvl + buf },
          pending: isLong ? price < lvl : price > lvl,
          rationale: 'Manual override (Entry Mode = Swing Confirm): entry set at the most recent swing level.',
        };
      }
      // falls through to AUTO if no swing level is available yet
    }

    // --- AUTO mode: derive the entry archetype from real analysis ---
    const breakEvent = structure.lastEvent?.direction === (isLong ? 'BULLISH' : 'BEARISH') ? structure.lastEvent : null;
    const barsSinceBreak = breakEvent ? exec.length - 1 - breakEvent.index : Infinity;
    const breakLevel = breakEvent?.price ?? null;

    const valueAreaLevel = isLong ? vp.vah : vp.val;
    const pocLevel = vp.poc?.price ?? null;

    const candidates = [];
    if (breakLevel != null) candidates.push({ level: breakLevel, label: 'the broken structure level', type: EntryType.RETEST_ENTRY });
    if (valueAreaLevel != null) candidates.push({ level: valueAreaLevel, label: isLong ? 'the Value Area High (VAH)' : 'the Value Area Low (VAL)', type: EntryType.VALUE_AREA_RETEST_ENTRY });
    if (pocLevel != null) candidates.push({ level: pocLevel, label: 'the POC', type: EntryType.POC_RETEST_ENTRY });

    // Only levels that make sense as support (LONG, below price) / resistance (SHORT, above price).
    const validSupport = candidates.filter((c) => (isLong ? c.level <= price : c.level >= price));
    validSupport.sort((a, b) => Math.abs(a.level - price) - Math.abs(b.level - price));
    const nearest = validSupport[0] || null;
    const distanceToNearestATR = nearest ? Math.abs(price - nearest.level) / atrV : Infinity;

    // Case 1: fresh break (within the last 2 candles) in our direction.
    if (breakEvent && barsSinceBreak <= 2) {
      const distFromBreakATR = Math.abs(price - breakLevel) / atrV;
      if (distFromBreakATR <= 0.4) {
        const buf = atrV * 0.15;
        return {
          price,
          type: EntryType.BREAKOUT_ENTRY,
          zone: { low: price - buf, high: price + buf },
          rationale: `Fresh ${breakEvent.type} ${barsSinceBreak} candle(s) ago with no pullback yet — entering near the breakout level itself, not chasing an extended price.`,
        };
      }
      const buf = atrV * 0.3;
      const zonePrice = isLong ? breakLevel + buf * 0.5 : breakLevel - buf * 0.5;
      return {
        price: zonePrice,
        type: EntryType.RETEST_ENTRY,
        zone: isLong ? { low: breakLevel - buf * 0.2, high: breakLevel + buf } : { low: breakLevel - buf, high: breakLevel + buf * 0.2 },
        pending: true,
        rationale: `Price is already ${distFromBreakATR.toFixed(1)} ATR beyond the ${breakEvent.type} level at ${breakLevel.toPrecision(6)} — Entry Zone set at that level for a retest, not at the current extended price.`,
      };
    }

    // Case 2: price is currently sitting near a valid structural/VP level — live retest.
    if (nearest && distanceToNearestATR <= 0.6) {
      const buf = atrV * 0.25;
      return {
        price: nearest.level,
        type: nearest.type,
        zone: isLong ? { low: nearest.level - buf * 0.3, high: nearest.level + buf } : { low: nearest.level - buf, high: nearest.level + buf * 0.3 },
        rationale: `Price is currently retesting ${nearest.label} (${distanceToNearestATR.toFixed(1)} ATR away) — Entry Zone anchored there.`,
      };
    }

    // Case 3: no fresh break and price isn't near any valid level right now —
    // set the zone at the nearest logical pullback target and mark it pending
    // (WAITING FOR RETEST) rather than chasing the current, extended price.
    const fallback = nearest ?? (() => {
      const lvl = isLong ? structure.lastMinorLow?.price : structure.lastMinorHigh?.price;
      return lvl ? { level: lvl, label: 'the most recent swing level', type: EntryType.RETEST_ENTRY } : null;
    })();
    if (fallback) {
      const buf = atrV * 0.3;
      return {
        price: fallback.level,
        type: fallback.type,
        zone: isLong ? { low: fallback.level - buf * 0.2, high: fallback.level + buf } : { low: fallback.level - buf, high: fallback.level + buf * 0.2 },
        pending: true,
        rationale: `No immediate trigger at the current price — Entry Zone set at ${fallback.label}${Number.isFinite(distanceToNearestATR) ? ` (${distanceToNearestATR.toFixed(1)} ATR away)` : ''}, waiting for a retest rather than entering now.`,
      };
    }

    // Last resort: nothing structural to anchor to — explicit Market Entry.
    const buf = atrV * 0.15;
    return {
      price,
      type: EntryType.MARKET_ENTRY,
      zone: { low: price - buf, high: price + buf },
      rationale: 'No nearby structural level to anchor a retest zone to — defaulting to an explicit Market Entry at the current price.',
    };
  }

  _structureTargets(direction, price, structure, vp) {
    const t = [];
    if (direction === 'LONG') {
      if (structure.lastMajorHigh?.price > price) t.push(structure.lastMajorHigh.price);
      if (structure.lastMinorHigh?.price > price) t.push(structure.lastMinorHigh.price);
      if (vp.vah && vp.vah > price) t.push(vp.vah);
      for (const n of vp.hvn || []) if (n.priceLow > price) t.push((n.priceLow + n.priceHigh) / 2);
    } else {
      if (structure.lastMajorLow?.price < price) t.push(structure.lastMajorLow.price);
      if (structure.lastMinorLow?.price < price) t.push(structure.lastMinorLow.price);
      if (vp.val && vp.val < price) t.push(vp.val);
      for (const n of vp.hvn || []) if (n.priceHigh < price) t.push((n.priceLow + n.priceHigh) / 2);
    }
    const uniq = [...new Set(t.map((x) => Number(x.toPrecision(10))))];
    return uniq.sort((a, b) => (direction === 'LONG' ? a - b : b - a));
  }

  _noTrade(symbol, config, code, reasons, extra = {}) {
    return {
      symbol,
      state: SignalState.NO_TRADE,
      direction: null,
      score: 0,
      reasons: [],
      warnings: [],
      failedConditions: [{ code, reasons }],
      strategyVersion: config.version,
      timestamp: Date.now(),
      disclaimer: 'Analytical signal only — not a guarantee of profit and not financial advice.',
      disclaimerAr: 'هذه الإشارات تحليلية وليست ضمانًا للربح ولا توصية مالية.',
      ...extra,
    };
  }

  _evaluateDirection(direction, ctx) {
    const { structure, volume, vp, pocInteraction, priceAction, indicators, price, config } = ctx;
    const variant = STRATEGY_VARIANTS[config.strategyVariant || 'FULL'] || STRATEGY_VARIANTS.FULL;
    const on = (c) => variant.components.includes(c);
    const isLong = direction === 'LONG';
    const reasons = [];
    const warnings = [];
    const failedConditions = [];
    const breakdown = { marketStructure: 0, poc: 0, volume: 0, priceAction: 0, ema: 0, rsi: 0, macd: 0, atrRisk: 0 };
    const flags = { volumeOk: false, pocOk: false };
    const want = isLong ? 'BULLISH' : 'BEARISH';

    if (on('marketStructure')) {
      const w = weightOf(config, 'marketStructure');
      const regimeOk = structure.regime === (isLong ? 'TREND_BULLISH' : 'TREND_BEARISH');
      const majorOk = structure.major?.trend === want;
      const lastBreak = structure.lastEvent;
      let s = 0;
      if (regimeOk) {
        s += w * 0.55;
        reasons.push(`${isLong ? 'Bullish' : 'Bearish'} minor structure (${isLong ? 'HH/HL' : 'LH/LL'})`);
      } else failedConditions.push(`Minor structure is not ${want.toLowerCase()}`);
      if (majorOk) {
        s += w * 0.25;
        reasons.push(`Major structure ${want.toLowerCase()}`);
      }
      if (lastBreak?.direction === want) {
        s += w * 0.1;
        reasons.push(`Last structural break: ${lastBreak.type} ${want.toLowerCase()}`);
        if (lastBreak.type === 'CHOCH') warnings.push('Recent CHoCH — the trend change is still young');
      }
      if (structure.recentRetest && structure.lastRetest?.direction === want) {
        s += w * 0.1;
        reasons.push('Broken level retested and holding');
      }
      breakdown.marketStructure = Math.min(w, s);
    }

    if (on('poc')) {
      const w = weightOf(config, 'poc');
      let s = 0;
      const pa = new Set((priceAction.patterns || []).map((p) => p.type));
      if (pocInteraction?.nearPoc) {
        s = w * 0.7;
        flags.pocOk = true;
        reasons.push('Price is interacting with the POC (Point of Control)');
        if (isLong && pa.has('POC_BOUNCE')) {
          s = w;
          reasons.push('Bounce from POC');
        }
        if (!isLong && pa.has('POC_REJECTION')) {
          s = w;
          reasons.push('Rejection at POC');
        }
      } else if (isLong && pocInteraction?.role === 'ABOVE_POC') {
        s = w * 0.4;
        flags.pocOk = Math.abs(pocInteraction.distancePct) < 1.2;
        reasons.push('Price holding above POC (support side)');
      } else if (!isLong && pocInteraction?.role === 'BELOW_POC') {
        s = w * 0.4;
        flags.pocOk = Math.abs(pocInteraction.distancePct) < 1.2;
        reasons.push('Price holding below POC (resistance side)');
      } else failedConditions.push('Price is on the wrong side of the POC');
      if (pocInteraction?.migration === (isLong ? 'POC_MIGRATED_UP' : 'POC_MIGRATED_DOWN')) {
        s = Math.min(w, s + w * 0.2);
        reasons.push(`POC migrating ${isLong ? 'up' : 'down'}`);
      }
      breakdown.poc = s;
    }

    if (on('volume') && volume.ready) {
      const w = weightOf(config, 'volume');
      const rv = volume.lastRelativeVolume;
      const tbr = volume.takerBuyRatioEstimated[volume.takerBuyRatioEstimated.length - 1];
      let s = 0;
      if (rv >= 1.5) {
        s += w * 0.6;
        flags.volumeOk = true;
        reasons.push(`Relative volume expanded (${rv.toFixed(2)}x average)`);
      } else if (rv >= 1) {
        s += w * 0.35;
        flags.volumeOk = true;
        reasons.push(`Relative volume above average (${rv.toFixed(2)}x)`);
      } else failedConditions.push(`Volume below average (${typeof rv === 'number' ? rv.toFixed(2) : '—'}x)`);
      if (typeof tbr === 'number') {
        if (isLong && tbr > 0.53) {
          s += w * 0.4;
          reasons.push(`Taker buy ratio ${(tbr * 100).toFixed(0)}% (estimated buy pressure)`);
        } else if (!isLong && tbr < 0.47) {
          s += w * 0.4;
          reasons.push(`Taker sell dominance ${((1 - tbr) * 100).toFixed(0)}% (estimated)`);
        }
      }
      if (volume.divergence && isLong) warnings.push(volume.divergence.detail);
      breakdown.volume = Math.min(w, s);
    }

    if (on('priceAction') && priceAction.ready) {
      const w = weightOf(config, 'priceAction');
      const bull = ['BULLISH_REJECTION', 'BULLISH_ENGULFING', 'SUPPORT_REACTION', 'POC_BOUNCE', 'LIQUIDITY_SWEEP_LOW', 'FAKE_BREAKOUT_DOWN', 'DOUBLE_BOTTOM', 'BREAKOUT_UP'];
      const bear = ['BEARISH_REJECTION', 'BEARISH_ENGULFING', 'RESISTANCE_REACTION', 'POC_REJECTION', 'LIQUIDITY_SWEEP_HIGH', 'FAKE_BREAKOUT_UP', 'DOUBLE_TOP', 'BREAKOUT_DOWN'];
      const mine = priceAction.patterns.filter((p) => (isLong ? bull : bear).includes(p.type));
      const opposite = priceAction.patterns.filter((p) => (isLong ? bear : bull).includes(p.type));
      if (mine.length) {
        breakdown.priceAction = Math.min(w, mine.length * (w / 2));
        mine.forEach((m) => reasons.push(`Confirmation: ${m.type.replace(/_/g, ' ').toLowerCase()}`));
      } else failedConditions.push('No confirming breakout/retest/candle pattern on the last closed candle');
      if (opposite.length) warnings.push(`Opposing price action: ${opposite.map((m) => m.type).join(', ')}`);
    }

    if (on('ema') && typeof indicators.ema20 === 'number' && typeof indicators.ema50 === 'number') {
      const w = weightOf(config, 'ema');
      const aligned = isLong
        ? price > indicators.ema20 && indicators.ema20 > indicators.ema50
        : price < indicators.ema20 && indicators.ema20 < indicators.ema50;
      if (aligned) {
        breakdown.ema = w;
        reasons.push('EMA 20/50 alignment supports the direction');
      } else failedConditions.push('EMA 20/50 not aligned with this direction');
    }

    if (on('rsi')) {
      const w = weightOf(config, 'rsi');
      if (!indicators.rsiReady) warnings.push('RSI is NOT_READY (insufficient warm-up) — ignored');
      else {
        const r = indicators.rsi;
        if (isLong && r > 40 && r < config.rsi.overbought) {
          breakdown.rsi = w;
          reasons.push(`RSI ${r.toFixed(1)} supportive (not overbought)`);
        } else if (!isLong && r < 60 && r > config.rsi.oversold) {
          breakdown.rsi = w;
          reasons.push(`RSI ${r.toFixed(1)} supportive (not oversold)`);
        } else if (isLong && r >= config.rsi.overbought) warnings.push(`RSI ${r.toFixed(1)} is overbought`);
        else if (!isLong && r <= config.rsi.oversold) warnings.push(`RSI ${r.toFixed(1)} is oversold`);
      }
    }

    if (on('macd')) {
      const w = weightOf(config, 'macd');
      if (!indicators.macdReady) warnings.push('MACD is NOT_READY (insufficient warm-up) — ignored');
      else {
        const { macdLine, macdSignal, macdHistogram } = indicators;
        const prevHistogram = ctx.macd.histogram[ctx.macd.histogram.length - 2];
        const momentumBuilding = isLong ? macdHistogram > prevHistogram : macdHistogram < prevHistogram;
        const crossInDirection = isLong ? macdLine > macdSignal : macdLine < macdSignal;
        if (crossInDirection && momentumBuilding) {
          breakdown.macd = w;
          reasons.push(`MACD confirms ${isLong ? 'bullish' : 'bearish'} momentum (${isLong ? 'above' : 'below'} signal line, histogram ${isLong ? 'rising' : 'falling'})`);
        } else if (crossInDirection) {
          breakdown.macd = w * 0.5;
          reasons.push(`MACD ${isLong ? 'above' : 'below'} signal line (${want.toLowerCase()}) but momentum not yet accelerating`);
        } else {
          failedConditions.push(`MACD not confirming ${want.toLowerCase()} momentum`);
        }
      }
    }

    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score: this._normalizeScore(score, config), breakdown, reasons, warnings, failedConditions, flags };
  }
}

export const signalEngine = new SignalEngine();
