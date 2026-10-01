/**
 * VolumeProfileEngine
 * -----------------------------------------------------------------------
 * Builds an OHLCV-based approximation of a volume profile: each candle's
 * volume is distributed across the price bins it spans (proportional to
 * how much of the candle's high-low range falls in each bin), NOT a
 * single-price average. This is explicitly labeled an OHLCV-based
 * approximation since Binance kline data has no tick-level trade prices.
 *
 * Computes:
 *   POC  — Point of Control: price bin with the highest volume
 *   VAH  — Value Area High
 *   VAL  — Value Area Low  (default value area = 70% of total volume,
 *          expanding outward from the POC bin, standard convention)
 *   HVN / LVN — High/Low Volume Nodes (local maxima/minima of the profile)
 */

export const DEFAULT_BIN_COUNT = 100;
export const DEFAULT_VALUE_AREA_PCT = 0.7;

function distributeCandleVolume(candle, binEdges, bins) {
  const { high, low, volume } = candle;
  if (volume <= 0) return;
  const range = high - low;

  if (range <= 0) {
    // Doji / single-price candle: dump all volume into the containing bin.
    const idx = findBinIndex(binEdges, high);
    if (idx !== -1) bins[idx] += volume;
    return;
  }

  // Distribute proportionally to overlap between [low, high] and each bin.
  for (let i = 0; i < bins.length; i++) {
    const binLow = binEdges[i];
    const binHigh = binEdges[i + 1];
    const overlapLow = Math.max(low, binLow);
    const overlapHigh = Math.min(high, binHigh);
    const overlap = overlapHigh - overlapLow;
    if (overlap > 0) {
      bins[i] += volume * (overlap / range);
    }
  }
}

function findBinIndex(binEdges, price) {
  for (let i = 0; i < binEdges.length - 1; i++) {
    if (price >= binEdges[i] && price <= binEdges[i + 1]) return i;
  }
  return -1;
}

function computeValueArea(bins, binEdges, pocIndex, targetPct) {
  const total = bins.reduce((a, b) => a + b, 0);
  if (total === 0) return { vah: null, val: null };
  let acc = bins[pocIndex];
  let lo = pocIndex;
  let hi = pocIndex;
  const target = total * targetPct;

  while (acc < target && (lo > 0 || hi < bins.length - 1)) {
    const volBelow = lo > 0 ? bins[lo - 1] : -1;
    const volAbove = hi < bins.length - 1 ? bins[hi + 1] : -1;
    if (volAbove >= volBelow) {
      hi = Math.min(hi + 1, bins.length - 1);
      acc += bins[hi];
    } else {
      lo = Math.max(lo - 1, 0);
      acc += bins[lo];
    }
    if (lo === 0 && hi === bins.length - 1) break;
  }

  return {
    val: binEdges[lo],
    vah: binEdges[hi + 1],
  };
}

function findVolumeNodes(bins, binEdges) {
  const hvn = [];
  const lvn = [];
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i] > bins[i - 1] && bins[i] > bins[i + 1]) {
      hvn.push({ priceLow: binEdges[i], priceHigh: binEdges[i + 1], volume: bins[i] });
    }
    if (bins[i] < bins[i - 1] && bins[i] < bins[i + 1]) {
      lvn.push({ priceLow: binEdges[i], priceHigh: binEdges[i + 1], volume: bins[i] });
    }
  }
  return { hvn, lvn };
}

export class VolumeProfileEngine {
  /**
   * @param {Array} candles closed candles, chronological
   * @param {Object} opts { binCount, valueAreaPct, rangeMode }
   */
  build(candles, opts = {}) {
    const binCount = opts.binCount || DEFAULT_BIN_COUNT;
    const valueAreaPct = opts.valueAreaPct || DEFAULT_VALUE_AREA_PCT;

    if (!candles.length) {
      return { ready: false, reason: 'NO_CANDLES' };
    }

    const priceMin = Math.min(...candles.map((c) => c.low));
    const priceMax = Math.max(...candles.map((c) => c.high));
    if (priceMax <= priceMin) return { ready: false, reason: 'DEGENERATE_RANGE' };

    const binSize = (priceMax - priceMin) / binCount;
    const binEdges = Array.from({ length: binCount + 1 }, (_, i) => priceMin + i * binSize);
    const bins = new Array(binCount).fill(0);

    for (const candle of candles) {
      distributeCandleVolume(candle, binEdges, bins);
    }

    let pocIndex = 0;
    for (let i = 1; i < bins.length; i++) {
      if (bins[i] > bins[pocIndex]) pocIndex = i;
    }

    const poc = {
      priceLow: binEdges[pocIndex],
      priceHigh: binEdges[pocIndex + 1],
      price: (binEdges[pocIndex] + binEdges[pocIndex + 1]) / 2,
      volume: bins[pocIndex],
    };

    const { val, vah } = computeValueArea(bins, binEdges, pocIndex, valueAreaPct);
    const { hvn, lvn } = findVolumeNodes(bins, binEdges);

    return {
      ready: true,
      methodology: 'OHLCV_APPROXIMATION', // not tick-level
      rangeMode: opts.rangeMode || 'FIXED_RANGE',
      binCount,
      binSize,
      priceMin,
      priceMax,
      bins,
      binEdges,
      poc,
      vah,
      val,
      hvn,
      lvn,
      totalVolume: bins.reduce((a, b) => a + b, 0),
    };
  }

  /** Fixed Range Volume Profile over an explicit candle slice. */
  fixedRange(candles, startIdx, endIdx, opts = {}) {
    const slice = candles.slice(startIdx, endIdx + 1);
    return this.build(slice, { ...opts, rangeMode: 'FIXED_RANGE' });
  }

  /** Visible Range Volume Profile — whatever candles are currently on screen. */
  visibleRange(visibleCandles, opts = {}) {
    return this.build(visibleCandles, { ...opts, rangeMode: 'VISIBLE_RANGE' });
  }

  /** Session Volume Profile — candles belonging to one UTC session/day. */
  sessionRange(candles, sessionStartMs, sessionEndMs, opts = {}) {
    const slice = candles.filter((c) => c.openTime >= sessionStartMs && c.openTime < sessionEndMs);
    return this.build(slice, { ...opts, rangeMode: 'SESSION' });
  }

  /** Custom Range Volume Profile — arbitrary caller-provided candle set. */
  customRange(candles, opts = {}) {
    return this.build(candles, { ...opts, rangeMode: 'CUSTOM' });
  }

  /**
   * Compares current POC to a previous profile's POC to classify
   * migration direction and whether price is currently retesting it.
   */
  classifyPocInteraction(currentPrice, poc, previousPoc) {
    if (!poc) return null;
    const migration = previousPoc
      ? poc.price > previousPoc.price
        ? 'POC_MIGRATED_UP'
        : poc.price < previousPoc.price
        ? 'POC_MIGRATED_DOWN'
        : 'POC_STABLE'
      : 'NO_PRIOR_POC';

    const distancePct = ((currentPrice - poc.price) / poc.price) * 100;
    const nearPoc = Math.abs(distancePct) < 0.15; // within 0.15% counts as "at POC"

    let role = null;
    if (nearPoc) role = 'AT_POC';
    else role = currentPrice > poc.price ? 'ABOVE_POC' : 'BELOW_POC';

    return { migration, distancePct, role, nearPoc };
  }
}

export const volumeProfileEngine = new VolumeProfileEngine();
