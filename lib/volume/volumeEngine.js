import { sma, ema, NOT_READY } from '../indicators';

/**
 * VolumeEngine — derives volume-based metrics from real Binance candle
 * fields only (volume, quoteVolume, takerBuyBaseVolume). Binance klines
 * do not expose true bid/ask-classified delta, so anything derived from
 * taker-buy vs total volume is explicitly labeled an ESTIMATE, never
 * "True Delta".
 */
export class VolumeEngine {
  analyze(candles, { smaPeriod = 20, emaPeriod = 20 } = {}) {
    if (!candles.length) {
      return { ready: false };
    }
    const volumes = candles.map((c) => c.volume);
    const volumeSma = sma(volumes, smaPeriod);
    const volumeEma = ema(volumes, emaPeriod);

    const relativeVolume = candles.map((c, i) =>
      volumeSma[i] ? c.volume / volumeSma[i] : NOT_READY
    );

    // Estimated taker-buy ratio (0..1). Not true bid/ask delta.
    const takerBuyRatio = candles.map((c) =>
      c.volume > 0 ? c.takerBuyBaseVolume / c.volume : NOT_READY
    );

    // Estimated delta: (takerBuy - takerSell) as a volume figure.
    const estimatedDelta = candles.map((c) => {
      if (c.volume <= 0) return NOT_READY;
      const takerSell = c.volume - c.takerBuyBaseVolume;
      return c.takerBuyBaseVolume - takerSell;
    });

    const last = candles.length - 1;
    const lastRelVol = relativeVolume[last];
    const isSpike = typeof lastRelVol === 'number' && lastRelVol >= 2;
    const isContraction = typeof lastRelVol === 'number' && lastRelVol <= 0.5;

    // Simple volume/price divergence check over the last N closed candles:
    // price makes a higher high while volume trend makes a lower high.
    const divergence = this._detectDivergence(candles, relativeVolume);

    return {
      ready: true,
      volumeSma,
      volumeEma,
      relativeVolume,
      takerBuyRatioEstimated: takerBuyRatio,
      estimatedDelta,
      lastRelativeVolume: lastRelVol,
      isVolumeSpike: isSpike,
      isVolumeContraction: isContraction,
      divergence,
    };
  }

  _detectDivergence(candles, relativeVolume, lookback = 20) {
    if (candles.length < lookback + 1) return null;
    const slice = candles.slice(-lookback);
    const volSlice = relativeVolume.slice(-lookback);

    let priceHighIdx = 0;
    let priceHigh2Idx = -1;
    for (let i = 1; i < slice.length; i++) {
      if (slice[i].high > slice[priceHighIdx].high) {
        priceHigh2Idx = priceHighIdx;
        priceHighIdx = i;
      }
    }
    if (priceHigh2Idx === -1) return null;

    const vol1 = volSlice[priceHighIdx];
    const vol2 = volSlice[priceHigh2Idx];
    if (typeof vol1 !== 'number' || typeof vol2 !== 'number') return null;

    if (priceHighIdx > priceHigh2Idx && slice[priceHighIdx].high > slice[priceHigh2Idx].high && vol1 < vol2) {
      return { type: 'BEARISH_DIVERGENCE', detail: 'Higher price high on weaker relative volume' };
    }
    return null;
  }
}

export const volumeEngine = new VolumeEngine();
