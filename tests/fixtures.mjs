// SYNTHETIC candle fixtures used ONLY by the unit tests to check the maths
// against known answers. The application itself never generates candles —
// all market data in the running app comes from Binance.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCandles(n, { start = 100, stepMs = 15 * 60_000, t0 = Date.UTC(2024, 0, 1), seed = 7, drift = 0.0002, vol = 0.004 } = {}) {
  const r = rng(seed);
  const out = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const open = price;
    const wave = Math.sin(i / 23) * 0.003;
    const close = open * (1 + drift + wave + (r() - 0.5) * vol);
    const high = Math.max(open, close) * (1 + r() * vol * 0.6);
    const low = Math.min(open, close) * (1 - r() * vol * 0.6);
    const volume = 100 + r() * 200 + (i % 37 === 0 ? 400 : 0);
    out.push({
      openTime: t0 + i * stepMs,
      closeTime: t0 + i * stepMs + stepMs - 1,
      open, high, low, close, volume,
      quoteVolume: volume * close,
      trades: Math.round(50 + r() * 100),
      takerBuyBaseVolume: volume * (0.4 + r() * 0.2),
      takerBuyQuoteVolume: volume * close * 0.5,
      isClosed: true,
    });
    price = close;
  }
  return out;
}

export function flatCandle(i, o, h, l, c, v = 100, stepMs = 60_000, t0 = Date.UTC(2024, 0, 1)) {
  return { openTime: t0 + i * stepMs, closeTime: t0 + i * stepMs + stepMs - 1, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c, trades: 10, takerBuyBaseVolume: v / 2, takerBuyQuoteVolume: v * c / 2, isClosed: true };
}
