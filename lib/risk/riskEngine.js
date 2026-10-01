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

    let sl;
    if (method === 'ATR') sl = atrStop ?? pct;
    else if (method === 'STRUCTURE') sl = swing ?? atrStop ?? pct;
    else {
      // STRUCTURE_ATR: swing plus a volatility buffer
      if (swing != null) {
        const buffer = atr ? atr * atrMultiplier * 0.3 : swing * 0.001;
        sl = isLong ? swing - buffer : swing + buffer;
      } else sl = atrStop ?? pct;
    }
    // Never allow a stop tighter than 0.5 ATR (noise) or on the wrong side.
    if (atr) {
      const minDist = atr * 0.5;
      if (Math.abs(entry - sl) < minDist) sl = isLong ? entry - minDist : entry + minDist;
    }
    if (isLong && sl >= entry) sl = atrStop ?? entry * 0.99;
    if (!isLong && sl <= entry) sl = atrStop ?? entry * 1.01;
    return sl;
  }

  computeTakeProfits(direction, entry, stopLoss, { rMultiples = [1, 2, 3], structureTargets = [] } = {}) {
    const riskDistance = Math.abs(entry - stopLoss);
    const rTargets = rMultiples.map((r) => ({
      label: `${r}R`,
      price: direction === 'LONG' ? entry + riskDistance * r : entry - riskDistance * r,
      rMultiple: r,
    }));

    // Prefer real structure targets (next swing / resistance / support)
    // when available and consistent with direction, else fall back to R multiples.
    const filteredStructureTargets = structureTargets
      .filter((t) => (direction === 'LONG' ? t > entry : t < entry))
      .sort((a, b) => (direction === 'LONG' ? a - b : b - a));

    return {
      riskDistance,
      rTargets,
      tp1: filteredStructureTargets[0] ?? rTargets[0]?.price,
      tp2: filteredStructureTargets[1] ?? rTargets[1]?.price,
      tp3: filteredStructureTargets[2] ?? rTargets[2]?.price,
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
    const stopLoss = this.computeStopLoss(direction, entry, opts);
    const tp = this.computeTakeProfits(direction, entry, stopLoss, opts);
    const rr = this.computeRiskReward(entry, stopLoss, tp.tp1);
    const sizing = this.suggestPositionSize({
      accountSize: opts.accountSize,
      riskPercent: opts.riskPercent,
      entry,
      stopLoss,
    });
    return { direction, entry, stopLoss, ...tp, riskRewardToTp1: rr, sizing };
  }
}

export const riskEngine = new RiskEngine();
