/**
 * RiskEngine — computes stop-loss, take-profit levels, R:R and a
 * SUGGESTED position size. This module NEVER places an order; it only
 * returns numbers for the UI / journal.
 */
export class RiskEngine {
  /**
   * @param {'LONG'|'SHORT'} direction
   * @param {number} entry
   * @param {Object} opts { structure, atr, method, atrMultiplier, accountSize, riskPercent, rMultiples }
   */
  /**
   * Returns { price, reason, usedMethod } — never a bare number. `reason`
   * is a plain-language sentence for the UI ("Why this stop"), and
   * `usedMethod` reports which branch actually fired (STRUCTURE_ATR can
   * fall back to ATR-only when no protective swing exists yet, and the
   * stop is always what really happened, not just what was requested).
   */
  computeStopLoss(direction, entry, opts) {
    const { method = 'STRUCTURE_ATR', structure, atr, atrMultiplier = 1.5 } = opts;
    const isLong = direction === 'LONG';
    // Nearest RECENT swing on the protective side of the entry (not just the
    // last major swing, which can be arbitrarily far away).
    const pool = isLong ? structure?.lows || [] : structure?.highs || [];
    const protective = [...pool].reverse().find((s) => (isLong ? s.price < entry : s.price > entry));
    const swing = protective?.price;
    const atrStop = atr ? (isLong ? entry - atr * atrMultiplier : entry + atr * atrMultiplier) : null;
    const pct = isLong ? entry * 0.98 : entry * 1.02;
    const swingWord = isLong ? 'recent swing low' : 'recent swing high';

    let sl;
    let usedMethod;
    if (method === 'ATR') {
      sl = atrStop ?? pct;
      usedMethod = atrStop != null ? 'ATR' : 'PERCENT_FALLBACK';
    } else if (method === 'STRUCTURE') {
      sl = swing ?? atrStop ?? pct;
      usedMethod = swing != null ? 'STRUCTURE' : atrStop != null ? 'ATR_FALLBACK' : 'PERCENT_FALLBACK';
    } else {
      // STRUCTURE_ATR: swing plus a volatility buffer
      if (swing != null) {
        const buffer = atr ? atr * atrMultiplier * 0.3 : swing * 0.001;
        sl = isLong ? swing - buffer : swing + buffer;
        usedMethod = 'STRUCTURE_ATR';
      } else {
        sl = atrStop ?? pct;
        usedMethod = atrStop != null ? 'ATR_FALLBACK' : 'PERCENT_FALLBACK';
      }
    }
    // Never allow a stop tighter than 0.5 ATR (noise) or on the wrong side.
    let clamped = false;
    if (atr) {
      const minDist = atr * 0.5;
      if (Math.abs(entry - sl) < minDist) {
        sl = isLong ? entry - minDist : entry + minDist;
        clamped = true;
      }
    }
    if (isLong && sl >= entry) {
      sl = atrStop ?? entry * 0.99;
      usedMethod = 'ATR_FALLBACK';
    }
    if (!isLong && sl <= entry) {
      sl = atrStop ?? entry * 1.01;
      usedMethod = 'ATR_FALLBACK';
    }

    const REASONS = {
      STRUCTURE_ATR: `Below the ${swingWord} at ${swing?.toPrecision?.(6)}, plus an ATR volatility buffer`,
      STRUCTURE: `At the ${swingWord} (${swing?.toPrecision?.(6)})`,
      ATR: `${atrMultiplier}\u00d7 ATR from entry (no reliable nearby swing)`,
      ATR_FALLBACK: `${atrMultiplier}\u00d7 ATR from entry (fallback — no protective swing found)`,
      PERCENT_FALLBACK: 'Fallback 2% from entry (ATR unavailable)',
    };
    let reason = REASONS[usedMethod] || REASONS.PERCENT_FALLBACK;
    if (clamped) reason += ', widened to at least 0.5\u00d7 ATR to avoid a noise-width stop';

    return { price: sl, reason, usedMethod };
  }

  computeTakeProfits(direction, entry, stopLossPrice, { rMultiples = [1, 2, 3], structureTargets = [] } = {}) {
    const riskDistance = Math.abs(entry - stopLossPrice);
    const rTargets = rMultiples.map((r) => ({
      label: `${r}R`,
      price: direction === 'LONG' ? entry + riskDistance * r : entry - riskDistance * r,
      rMultiple: r,
    }));

    // Prefer real structure targets (next swing / resistance / support /
    // value-area edge / high-volume node) when available and consistent
    // with direction, else fall back to R multiples.
    const filteredStructureTargets = structureTargets
      .filter((t) => (direction === 'LONG' ? t > entry : t < entry))
      .sort((a, b) => (direction === 'LONG' ? a - b : b - a));

    const pick = (i) => (filteredStructureTargets[i] != null ? filteredStructureTargets[i] : rTargets[i]?.price);
    const reasonFor = (i) =>
      filteredStructureTargets[i] != null
        ? `Next structural level / liquidity area (${filteredStructureTargets[i].toPrecision(6)})`
        : `${rMultiples[i]}\u00d7 risk (no further structural level found)`;

    return {
      riskDistance,
      rTargets,
      tp1: pick(0),
      tp2: pick(1),
      tp3: pick(2),
      tp1Reason: reasonFor(0),
      tp2Reason: reasonFor(1),
      tp3Reason: reasonFor(2),
    };
  }

  computeRiskReward(entry, stopLoss, takeProfit) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk === 0) return null;
    return reward / risk;
  }

  /**
   * Suggested position size only — never executed.
   * positionSize (in base asset units) = riskAmount / riskDistancePerUnit
   */
  suggestPositionSize({ accountSize, riskPercent, entry, stopLoss }) {
    const riskAmount = accountSize * (riskPercent / 100);
    const riskDistance = Math.abs(entry - stopLoss);
    if (riskDistance === 0) return { riskAmount, positionSizeBase: 0, positionSizeQuote: 0 };
    const positionSizeBase = riskAmount / riskDistance;
    const positionSizeQuote = positionSizeBase * entry;
    return { riskAmount, riskDistance, positionSizeBase, positionSizeQuote };
  }

  fullPlan(direction, entry, opts) {
    const sl = this.computeStopLoss(direction, entry, opts);
    const tp = this.computeTakeProfits(direction, entry, sl.price, opts);
    const rr = this.computeRiskReward(entry, sl.price, tp.tp1);
    const sizing = this.suggestPositionSize({
      accountSize: opts.accountSize,
      riskPercent: opts.riskPercent,
      entry,
      stopLoss: sl.price,
    });
    return { direction, entry, stopLoss: sl.price, stopLossReason: sl.reason, ...tp, riskRewardToTp1: rr, sizing };
  }
}

export const riskEngine = new RiskEngine();
