/**
 * FuturesContextEngine
 * -----------------------------------------------------------------------
 * Turns raw Futures data (funding rate, open interest, long/short ratio,
 * liquidations) into explainable, labeled context for a Futures entry.
 *
 * DELIBERATELY NOT part of the scored confluence (see signalEngine.js):
 * the backtester only has historical candles, not historical funding/OI/
 * liquidation data, so this engine's output can never be validated the
 * way the structure/POC/volume/MTF score components are. Mixing it into
 * the score would produce a number that looks tested but isn't. Instead
 * it is shown as its own panel with its own reasons/warnings, and is
 * included as extra context in notifications — never as a score input.
 */

const HIGH_FUNDING_PCT = 0.03; // 0.03% per 8h ≈ ~32.8% annualized — commonly cited "elevated" threshold
const EXTREME_FUNDING_PCT = 0.08; // ≈ ~87% annualized
const EXTREME_LONG_SHORT_RATIO = 2.2; // global accounts long:short
const EXTREME_SHORT_LONG_RATIO = 0.45;

export class FuturesContextEngine {
  build({ direction, futuresSnapshot, liquidationPressure, marketContext }) {
    const reasons = [];
    const warnings = [];
    const facts = {};

    if (futuresSnapshot?.fundingRate != null) {
      const fundingPct = futuresSnapshot.fundingRate * 100;
      facts.fundingRatePct = fundingPct;
      facts.fundingRateAnnualizedPct = fundingPct * 3 * 365;
      const extreme = Math.abs(fundingPct) >= EXTREME_FUNDING_PCT;
      const elevated = Math.abs(fundingPct) >= HIGH_FUNDING_PCT;

      if (fundingPct > 0) {
        // Longs pay shorts: crowd is net long.
        if (direction === 'SHORT' && elevated) reasons.push(`Positive funding (${fundingPct.toFixed(4)}%/8h) — crowd is net long, supportive tailwind for shorts`);
        if (direction === 'LONG' && extreme) warnings.push(`Funding is extremely positive (${fundingPct.toFixed(4)}%/8h) — longs are crowded and paying a high cost; long-squeeze risk`);
        else if (direction === 'LONG' && elevated) warnings.push(`Funding is elevated positive (${fundingPct.toFixed(4)}%/8h) — longs are paying shorts, mild crowding`);
      } else if (fundingPct < 0) {
        // Shorts pay longs: crowd is net short.
        if (direction === 'LONG' && elevated) reasons.push(`Negative funding (${fundingPct.toFixed(4)}%/8h) — crowd is net short, supportive tailwind for longs`);
        if (direction === 'SHORT' && extreme) warnings.push(`Funding is extremely negative (${fundingPct.toFixed(4)}%/8h) — shorts are crowded and paying a high cost; short-squeeze risk`);
        else if (direction === 'SHORT' && elevated) warnings.push(`Funding is elevated negative (${fundingPct.toFixed(4)}%/8h) — shorts are paying longs, mild crowding`);
      }
    }

    if (futuresSnapshot?.openInterestHistory?.length >= 2) {
      const h = futuresSnapshot.openInterestHistory;
      const oiChangePct = ((h[h.length - 1].oi - h[0].oi) / h[0].oi) * 100;
      facts.openInterestChangePct = oiChangePct;
      if (Math.abs(oiChangePct) >= 3) {
        const rising = oiChangePct > 0;
        if (rising) reasons.push(`Open interest rising (${oiChangePct.toFixed(1)}% over the window) — new positioning backing the move, not just short-covering`);
        else warnings.push(`Open interest falling (${oiChangePct.toFixed(1)}%) — the move may be driven by position unwinding rather than fresh conviction`);
      }
    }

    if (futuresSnapshot?.longShortRatioHistory?.length) {
      const last = futuresSnapshot.longShortRatioHistory[futuresSnapshot.longShortRatioHistory.length - 1];
      facts.longShortRatio = last.ratio;
      if (last.ratio >= EXTREME_LONG_SHORT_RATIO) {
        warnings.push(`Long/Short account ratio is extreme (${last.ratio.toFixed(2)}) — crowd heavily net long, contrarian caution${direction === 'LONG' ? ' on this LONG' : ''}`);
      } else if (last.ratio <= EXTREME_SHORT_LONG_RATIO) {
        warnings.push(`Long/Short account ratio is extreme (${last.ratio.toFixed(2)}) — crowd heavily net short, contrarian caution${direction === 'SHORT' ? ' on this SHORT' : ''}`);
      }
    }

    if (liquidationPressure && liquidationPressure.count > 0) {
      facts.liquidations15m = liquidationPressure;
      const { longsLiquidatedUsd, shortsLiquidatedUsd } = liquidationPressure;
      if (direction === 'LONG' && shortsLiquidatedUsd > longsLiquidatedUsd * 1.5 && shortsLiquidatedUsd > 50_000) {
        reasons.push(`Recent short liquidations (~$${Math.round(shortsLiquidatedUsd).toLocaleString('en-US')}) in the last 15m — short-side fuel already spent`);
      }
      if (direction === 'SHORT' && longsLiquidatedUsd > shortsLiquidatedUsd * 1.5 && longsLiquidatedUsd > 50_000) {
        reasons.push(`Recent long liquidations (~$${Math.round(longsLiquidatedUsd).toLocaleString('en-US')}) in the last 15m — long-side fuel already spent`);
      }
      if (direction === 'LONG' && longsLiquidatedUsd > 100_000) {
        warnings.push(`Longs are actively being liquidated (~$${Math.round(longsLiquidatedUsd).toLocaleString('en-US')} in 15m) — the drop may not be done`);
      }
      if (direction === 'SHORT' && shortsLiquidatedUsd > 100_000) {
        warnings.push(`Shorts are actively being liquidated (~$${Math.round(shortsLiquidatedUsd).toLocaleString('en-US')} in 15m) — the squeeze may not be done`);
      }
    }

    if (marketContext?.fearGreed?.value != null) {
      const v = marketContext.fearGreed.value;
      facts.fearGreed = v;
      facts.fearGreedLabel = marketContext.fearGreed.classification;
      if (v <= 20) warnings.push(`Whole-market sentiment is Extreme Fear (${v}/100) — high sensitivity to further bad news, but also classic capitulation zone`);
      if (v >= 80) warnings.push(`Whole-market sentiment is Extreme Greed (${v}/100) — euphoria risk, sharp corrections more likely`);
    }

    return {
      ready: !!(futuresSnapshot || liquidationPressure || marketContext),
      facts,
      reasons,
      warnings,
      disclaimer: 'Futures context is informational only — it is NOT part of the scored confluence and has not been backtested.',
      disclaimerAr: 'سياق الفيوتشر معلومات إضافية فقط — غير مُدرج في درجة التوافق ولم يُختبر تاريخيًا.',
    };
  }

  /** Rough, leverage-education-only liquidation price estimates (isolated margin, no fees). */
  estimateLiquidation(direction, entry, leverages = [5, 10, 20, 25]) {
    const isLong = direction === 'LONG';
    const out = {};
    for (const lev of leverages) {
      // Simplified isolated-margin estimate: liq ≈ entry * (1 ∓ 1/leverage).
      // Real exchange liquidation price also factors maintenance margin rate
      // and fees, so this is intentionally conservative/approximate — label
      // it as such everywhere it is shown.
      const move = 1 / lev;
      out[`${lev}x`] = isLong ? entry * (1 - move) : entry * (1 + move);
    }
    return { estimates: out, methodology: 'APPROXIMATE_ISOLATED_NO_FEES' };
  }
}

export const futuresContextEngine = new FuturesContextEngine();
