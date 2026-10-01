/**
 * Technical indicator library. All functions take an array of closed
 * candles (oldest -> newest) and return an array of the same length,
 * where indices without enough warm-up data are `null` rather than a
 * fabricated number (see RSI_ACCURACY: no RSI = fake value).
 *
 * Formulas follow the standard/classic definitions (Wilder for
 * RSI/ATR/ADX, EMA/SMA per convention) — documented inline per method.
 */

export const NOT_READY = null;

function closesOf(candles) {
  return candles.map((c) => c.close);
}

/** Simple Moving Average. */
export function sma(values, period) {
  const out = new Array(values.length).fill(NOT_READY);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential Moving Average, seeded with an SMA of the first `period` values. */
export function ema(values, period) {
  const out = new Array(values.length).fill(NOT_READY);
  const k = 2 / (period + 1);
  let seed = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += values[j];
      seed = sum / period;
      out[i] = seed;
    } else if (i >= period) {
      out[i] = values[i] * k + out[i - 1] * (1 - k);
    }
  }
  return out;
}

/**
 * RSI — Wilder's smoothing (RMA), the same convention as TradingView /
 * Binance charts. The first average gain/loss is the simple mean of the
 * first `period` changes, then avg = (prev*(period-1) + current)/period.
 *
 * WARM-UP RULE: Wilder smoothing carries the memory of all earlier
 * candles, so a value computed from only `period` candles is unstable.
 * Every index before `period + warmupExtra` is returned as NOT_READY
 * (null) — never a fabricated number. Callers must treat null as
 * "indicator not ready".
 */
export function rsi(candles, period = 14, warmupExtra = 50) {
  const closes = closesOf(candles);
  const out = new Array(closes.length).fill(NOT_READY);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain += Math.max(0, ch);
    avgLoss += Math.max(0, -ch);
  }
  avgGain /= period;
  avgLoss /= period;

  const value = (ag, al) => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  const readyFrom = period + warmupExtra;
  if (period >= readyFrom) out[period] = value(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, ch)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -ch)) / period;
    if (i >= readyFrom) out[i] = value(avgGain, avgLoss);
  }
  return out;
}

/** MACD: { macdLine, signalLine, histogram }, each an array aligned to input. */
export function macd(candles, fast = 12, slow = 26, signalPeriod = 9) {
  const closes = closesOf(candles);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== NOT_READY && emaSlow[i] !== NOT_READY ? emaFast[i] - emaSlow[i] : NOT_READY
  );
  const macdValuesOnly = macdLine.map((v) => (v === NOT_READY ? 0 : v));
  const signalRaw = ema(macdValuesOnly, signalPeriod);
  const firstMacdIdx = macdLine.findIndex((v) => v !== NOT_READY);
  const signalLine = signalRaw.map((v, i) => (i >= firstMacdIdx + signalPeriod - 1 ? v : NOT_READY));
  const histogram = macdLine.map((v, i) =>
    v !== NOT_READY && signalLine[i] !== NOT_READY ? v - signalLine[i] : NOT_READY
  );
  return { macdLine, signalLine, histogram };
}

/** Average True Range, Wilder smoothing. */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(NOT_READY);
  if (candles.length < period + 1) return out;
  const trs = [NOT_READY];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    trs.push(tr);
  }
  let avg = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = avg;
  for (let i = period + 1; i < candles.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
    out[i] = avg;
  }
  return out;
}

/** ADX (Wilder), returns { adx, plusDI, minusDI }. */
export function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  const smooth = (arr) => {
    const out = new Array(n).fill(NOT_READY);
    if (n < period + 1) return out;
    let sum = arr.slice(1, period + 1).reduce((a, b) => a + b, 0);
    out[period] = sum;
    for (let i = period + 1; i < n; i++) {
      sum = sum - sum / period + arr[i];
      out[i] = sum;
    }
    return out;
  };

  const trSmooth = smooth(tr);
  const plusDMSmooth = smooth(plusDM);
  const minusDMSmooth = smooth(minusDM);

  const plusDI = new Array(n).fill(NOT_READY);
  const minusDI = new Array(n).fill(NOT_READY);
  const dx = new Array(n).fill(NOT_READY);

  for (let i = period; i < n; i++) {
    if (trSmooth[i] && trSmooth[i] !== 0) {
      plusDI[i] = (100 * plusDMSmooth[i]) / trSmooth[i];
      minusDI[i] = (100 * minusDMSmooth[i]) / trSmooth[i];
      const diSum = plusDI[i] + minusDI[i];
      dx[i] = diSum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / diSum;
    }
  }

  const adxOut = new Array(n).fill(NOT_READY);
  const firstDx = period;
  if (n >= firstDx + period) {
    let sum = 0;
    let count = 0;
    for (let i = firstDx; i < firstDx + period; i++) {
      if (dx[i] !== NOT_READY) {
        sum += dx[i];
        count++;
      }
    }
    let avgDx = count ? sum / count : NOT_READY;
    adxOut[firstDx + period - 1] = avgDx;
    for (let i = firstDx + period; i < n; i++) {
      if (dx[i] === NOT_READY) continue;
      avgDx = (avgDx * (period - 1) + dx[i]) / period;
      adxOut[i] = avgDx;
    }
  }

  return { adx: adxOut, plusDI, minusDI };
}

/** Stochastic Oscillator %K / %D. */
export function stochastic(candles, kPeriod = 14, dPeriod = 3) {
  const n = candles.length;
  const percentK = new Array(n).fill(NOT_READY);
  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    const range = hi - lo;
    percentK[i] = range === 0 ? 50 : ((candles[i].close - lo) / range) * 100;
  }
  const kVals = percentK.map((v) => (v === NOT_READY ? 0 : v));
  const dRaw = sma(kVals, dPeriod);
  const firstK = percentK.findIndex((v) => v !== NOT_READY);
  const percentD = dRaw.map((v, i) => (i >= firstK + dPeriod - 1 ? v : NOT_READY));
  return { percentK, percentD };
}

/** Bollinger Bands: { upper, middle, lower }. */
export function bollingerBands(candles, period = 20, stdDevMultiplier = 2) {
  const closes = closesOf(candles);
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(NOT_READY);
  const lower = new Array(closes.length).fill(NOT_READY);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((a, v) => a + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdDevMultiplier * sd;
    lower[i] = mean - stdDevMultiplier * sd;
  }
  return { upper, middle, lower };
}

/** Session/rolling VWAP computed from the provided candle window (typical price * volume). */
export function vwap(candles) {
  const out = new Array(candles.length).fill(NOT_READY);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typical * candles[i].volume;
    cumV += candles[i].volume;
    out[i] = cumV === 0 ? NOT_READY : cumPV / cumV;
  }
  return out;
}

export function volumeSma(candles, period = 20) {
  return sma(candles.map((c) => c.volume), period);
}

export function relativeVolume(candles, period = 20) {
  const volSma = volumeSma(candles, period);
  return candles.map((c, i) => (volSma[i] ? c.volume / volSma[i] : NOT_READY));
}

/** Standard EMA set used across the app: 9/20/50/100/200. */
export function emaSet(candles) {
  const closes = closesOf(candles);
  return {
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema100: ema(closes, 100),
    ema200: ema(closes, 200),
  };
}

export function smaSet(candles) {
  const closes = closesOf(candles);
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
  };
}

export function lastReady(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== NOT_READY && arr[i] !== undefined) return arr[i];
  }
  return NOT_READY;
}
