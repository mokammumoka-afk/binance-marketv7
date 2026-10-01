/**
 * Unified candle model + CandleValidator.
 *
 * Binance kline array shape (per REST/WS docs):
 * [ openTime, open, high, low, close, volume, closeTime, quoteVolume,
 *   trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore ]
 */

export function candleFromRestKline(raw) {
  return {
    openTime: raw[0],
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
    volume: Number(raw[5]),
    closeTime: raw[6],
    quoteVolume: Number(raw[7]),
    trades: Number(raw[8]),
    takerBuyBaseVolume: Number(raw[9]),
    takerBuyQuoteVolume: Number(raw[10]),
    // A REST kline is only final once its closeTime has passed. The most
    // recent kline returned by Binance is usually still forming.
    isClosed: raw[6] < Date.now(),
  };
}

// Binance kline WebSocket event ("k" object)
export function candleFromWsKline(k) {
  return {
    openTime: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    closeTime: k.T,
    quoteVolume: Number(k.q),
    trades: Number(k.n),
    takerBuyBaseVolume: Number(k.V),
    takerBuyQuoteVolume: Number(k.Q),
    isClosed: Boolean(k.x),
  };
}

export const ValidationIssue = Object.freeze({
  HIGH_LOW_INVALID: 'HIGH_LOW_INVALID',
  NEGATIVE_VOLUME: 'NEGATIVE_VOLUME',
  NON_MONOTONIC_TIME: 'NON_MONOTONIC_TIME',
  GAP_DETECTED: 'GAP_DETECTED',
  NAN_FIELD: 'NAN_FIELD',
});

/**
 * CandleValidator — validates a single candle in isolation, and a full
 * series for ordering / gap integrity. Never silently treats a gappy
 * series as clean: gaps are reported so callers can refuse to signal on
 * incomplete data (see NO_TRADE_CONDITIONS in the signal engine).
 */
export class CandleValidator {
  static validateOne(candle) {
    const issues = [];
    const fields = ['open', 'high', 'low', 'close', 'volume', 'quoteVolume', 'trades'];
    for (const f of fields) {
      if (candle[f] === undefined || Number.isNaN(candle[f])) {
        issues.push({ type: ValidationIssue.NAN_FIELD, field: f });
      }
    }
    if (candle.high < Math.max(candle.open, candle.close)) {
      issues.push({ type: ValidationIssue.HIGH_LOW_INVALID, detail: 'high < max(open, close)' });
    }
    if (candle.low > Math.min(candle.open, candle.close)) {
      issues.push({ type: ValidationIssue.HIGH_LOW_INVALID, detail: 'low > min(open, close)' });
    }
    if (candle.volume < 0) {
      issues.push({ type: ValidationIssue.NEGATIVE_VOLUME });
    }
    return { valid: issues.length === 0, issues };
  }

  /**
   * Validates ordering + detects missing candles given the expected
   * interval duration in ms. Returns { valid, gaps, duplicates }.
   */
  static validateSeries(candles, intervalMs) {
    const gaps = [];
    const duplicates = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const cur = candles[i];
      if (cur.openTime === prev.openTime) {
        duplicates.push({ index: i, openTime: cur.openTime });
        continue;
      }
      if (cur.openTime < prev.openTime) {
        return { valid: false, gaps, duplicates, error: ValidationIssue.NON_MONOTONIC_TIME, atIndex: i };
      }
      const expectedDelta = intervalMs;
      const actualDelta = cur.openTime - prev.openTime;
      if (actualDelta > expectedDelta) {
        const missingCount = Math.round(actualDelta / expectedDelta) - 1;
        gaps.push({
          afterIndex: i - 1,
          fromOpenTime: prev.openTime,
          toOpenTime: cur.openTime,
          missingCandles: missingCount,
        });
      }
    }
    return { valid: gaps.length === 0 && duplicates.length === 0, gaps, duplicates };
  }
}

export const INTERVAL_MS = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '8h': 8 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

export const SUPPORTED_INTERVALS = Object.keys(INTERVAL_MS);


/** Removes trailing candles that are still forming (CLOSED CANDLE POLICY). */
export function onlyClosed(candles, now = Date.now()) {
  let end = candles.length;
  while (end > 0 && (candles[end - 1].isClosed === false || candles[end - 1].closeTime >= now)) end--;
  return end === candles.length ? candles : candles.slice(0, end);
}

/** Groups candles into a coarser interval aligned to wall-clock boundaries (causal, no future data). */
export function resampleByTime(candles, targetMs) {
  const out = [];
  let cur = null;
  for (const c of candles) {
    const bucket = Math.floor(c.openTime / targetMs) * targetMs;
    if (!cur || cur.openTime !== bucket) {
      if (cur) out.push(cur);
      cur = { ...c, openTime: bucket, closeTime: bucket + targetMs - 1, isClosed: false, _n: 1 };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
      cur.quoteVolume += c.quoteVolume;
      cur.trades += c.trades;
      cur.takerBuyBaseVolume += c.takerBuyBaseVolume;
      cur.takerBuyQuoteVolume += c.takerBuyQuoteVolume;
      cur._n += 1;
    }
    // bucket complete when the last constituent candle closes at bucket end
    if (c.closeTime >= cur.closeTime - 1) cur.isClosed = c.isClosed !== false;
  }
  if (cur) out.push(cur);
  return out.map(({ _n, ...rest }) => rest);
}
