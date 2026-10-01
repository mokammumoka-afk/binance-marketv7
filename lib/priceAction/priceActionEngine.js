/**
 * PriceActionEngine — classic candlestick / structure price-action
 * patterns computed directly from OHLC, evaluated on CLOSED candles.
 */

function body(c) {
  return Math.abs(c.close - c.open);
}
function range(c) {
  return c.high - c.low;
}
function upperWick(c) {
  return c.high - Math.max(c.open, c.close);
}
function lowerWick(c) {
  return Math.min(c.open, c.close) - c.low;
}
function isBullish(c) {
  return c.close > c.open;
}
function isBearish(c) {
  return c.close < c.open;
}

export class PriceActionEngine {
  analyze(candles, { poc = null, support = null, resistance = null } = {}) {
    if (candles.length < 3) return { ready: false };
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const patterns = [];

    // Pin bar / rejection wick (wick >= 2x body, on the opposite side of close)
    const r = range(last) || 1e-9;
    if (lowerWick(last) / r >= 0.5 && upperWick(last) / r < 0.2) {
      patterns.push({ type: 'BULLISH_REJECTION', detail: 'Long lower wick, rejection of lower prices' });
    }
    if (upperWick(last) / r >= 0.5 && lowerWick(last) / r < 0.2) {
      patterns.push({ type: 'BEARISH_REJECTION', detail: 'Long upper wick, rejection of higher prices' });
    }

    if (body(last) / r <= 0.25 && r > 0) {
      patterns.push({ type: 'PIN_BAR', detail: 'Small body relative to range' });
    }

    // Engulfing
    if (isBullish(last) && isBearish(prev) && last.close > prev.open && last.open < prev.close) {
      patterns.push({ type: 'BULLISH_ENGULFING' });
    }
    if (isBearish(last) && isBullish(prev) && last.open > prev.close && last.close < prev.open) {
      patterns.push({ type: 'BEARISH_ENGULFING' });
    }

    // Inside bar
    if (last.high <= prev.high && last.low >= prev.low) {
      patterns.push({ type: 'INSIDE_BAR' });
    }

    // Strong body / compression / expansion (relative to recent average range)
    const recent = candles.slice(-20);
    const avgRange = recent.reduce((a, c) => a + range(c), 0) / recent.length;
    if (avgRange > 0) {
      if (range(last) >= avgRange * 1.5) patterns.push({ type: 'EXPANSION', detail: 'Range well above average' });
      if (range(last) <= avgRange * 0.5) patterns.push({ type: 'COMPRESSION', detail: 'Range well below average' });
      if (body(last) / r >= 0.7) patterns.push({ type: 'STRONG_BODY' });
    }

    // Breakout / fake breakout vs recent swing range
    const lookback = candles.slice(-21, -1);
    if (lookback.length) {
      const recentHigh = Math.max(...lookback.map((c) => c.high));
      const recentLow = Math.min(...lookback.map((c) => c.low));
      if (last.close > recentHigh) {
        patterns.push({ type: 'BREAKOUT_UP', level: recentHigh });
      } else if (last.high > recentHigh && last.close < recentHigh) {
        patterns.push({ type: 'FAKE_BREAKOUT_UP', level: recentHigh, detail: 'Wicked above range but closed back inside' });
      }
      if (last.close < recentLow) {
        patterns.push({ type: 'BREAKOUT_DOWN', level: recentLow });
      } else if (last.low < recentLow && last.close > recentLow) {
        patterns.push({ type: 'FAKE_BREAKOUT_DOWN', level: recentLow, detail: 'Wicked below range but closed back inside' });
      }

      // Liquidity sweep: wick takes out a recent extreme by a small margin then reverses
      if (last.high > recentHigh && isBearish(last)) {
        patterns.push({ type: 'LIQUIDITY_SWEEP_HIGH', level: recentHigh });
      }
      if (last.low < recentLow && isBullish(last)) {
        patterns.push({ type: 'LIQUIDITY_SWEEP_LOW', level: recentLow });
      }
    }

    // Double top / bottom (rough): two closes within 0.2% of each other separated by >=5 candles, with a pullback between
    const dtdb = this._detectDoubleTopBottom(candles);
    if (dtdb) patterns.push(dtdb);

    // POC / support / resistance reaction
    if (poc) {
      const distPct = Math.abs(last.close - poc.price) / poc.price;
      if (distPct < 0.0015) {
        patterns.push({ type: isBullish(last) ? 'POC_BOUNCE' : 'POC_REJECTION', level: poc.price });
      }
    }
    if (support && Math.abs(last.low - support) / support < 0.002 && isBullish(last)) {
      patterns.push({ type: 'SUPPORT_REACTION', level: support });
    }
    if (resistance && Math.abs(last.high - resistance) / resistance < 0.002 && isBearish(last)) {
      patterns.push({ type: 'RESISTANCE_REACTION', level: resistance });
    }

    return { ready: true, patterns, lastCandle: last };
  }

  _detectDoubleTopBottom(candles, lookback = 40, tolerancePct = 0.002, minSeparation = 5) {
    const slice = candles.slice(-lookback);
    if (slice.length < minSeparation + 2) return null;
    const highs = slice.map((c) => c.high);
    const lows = slice.map((c) => c.low);
    const maxHigh = Math.max(...highs);
    const maxIdx = highs.lastIndexOf(maxHigh);
    for (let i = 0; i < highs.length; i++) {
      if (Math.abs(i - maxIdx) >= minSeparation && Math.abs(highs[i] - maxHigh) / maxHigh < tolerancePct) {
        return { type: 'DOUBLE_TOP', level: maxHigh };
      }
    }
    const minLow = Math.min(...lows);
    const minIdx = lows.lastIndexOf(minLow);
    for (let i = 0; i < lows.length; i++) {
      if (Math.abs(i - minIdx) >= minSeparation && Math.abs(lows[i] - minLow) / minLow < tolerancePct) {
        return { type: 'DOUBLE_BOTTOM', level: minLow };
      }
    }
    return null;
  }
}

export const priceActionEngine = new PriceActionEngine();
