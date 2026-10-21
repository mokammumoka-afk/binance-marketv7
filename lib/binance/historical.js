import { binanceRest } from './rest';
import { candleFromRestKline, CandleValidator, INTERVAL_MS } from '../data/candle';

const MAX_LIMIT_PER_REQUEST = 1000; // Binance klines hard cap

/**
 * HistoricalDataEngine
 * -----------------------------------------------------------------------
 * Responsible for downloading historical candles from Binance with:
 *   - automatic pagination (a single request never assumed to return
 *     the full requested range)
 *   - in-memory + pluggable persistent cache (dedup by openTime)
 *   - sorting, validation, gap detection
 *   - re-fetching of detected gaps
 */
export class HistoricalDataEngine {
  constructor({ rest = binanceRest, cache = null } = {}) {
    this.rest = rest;
    this.cache = cache; // optional CandleCache (see lib/storage/db.js)
    this._memCache = new Map(); // key -> sorted candle[]
  }

  _key(symbol, interval) {
    return `${symbol.toUpperCase()}:${interval}`;
  }

  /**
   * Fetches candles between startTime and endTime (ms epoch), inclusive,
   * splitting automatically into <=1000-candle batches.
   */
  async fetchRange({ symbol, interval, startTime, endTime, onProgress }) {
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) throw new Error(`Unsupported interval: ${interval}`);

    const batches = [];
    let cursor = startTime;
    const spanPerBatch = intervalMs * MAX_LIMIT_PER_REQUEST;

    while (cursor <= endTime) {
      const batchEnd = Math.min(cursor + spanPerBatch - intervalMs, endTime);
      batches.push([cursor, batchEnd]);
      cursor = batchEnd + intervalMs;
    }

    let all = [];
    for (let i = 0; i < batches.length; i++) {
      const [bStart, bEnd] = batches[i];
      const raw = await this.rest.klines({
        symbol,
        interval,
        startTime: bStart,
        endTime: bEnd,
        limit: MAX_LIMIT_PER_REQUEST,
      });
      const candles = raw.map(candleFromRestKline);
      all = all.concat(candles);
      onProgress?.({ batch: i + 1, totalBatches: batches.length, candlesSoFar: all.length });
    }

    return this._mergeDedupSort(all);
  }

  /**
   * Fetches the most recent `count` candles (may internally paginate if
   * count > 1000).
   */
  async fetchRecent({ symbol, interval, count = 500, onProgress }) {
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) throw new Error(`Unsupported interval: ${interval}`);
    const now = Date.now();
    const startTime = now - count * intervalMs;
    return this.fetchRange({ symbol, interval, startTime, endTime: now, onProgress });
  }

  _mergeDedupSort(candles) {
    const byTime = new Map();
    for (const c of candles) byTime.set(c.openTime, c);
    return Array.from(byTime.values()).sort((a, b) => a.openTime - b.openTime);
  }

  /**
   * Loads candles for symbol/interval, merges with anything cached, and
   * returns { candles, validation } where validation reports gaps and
   * duplicates found in the final series (post-merge).
   */
  async load({ symbol, interval, count = 500, useCache = true }) {
    const key = this._key(symbol, interval);
    let cached = useCache ? this._memCache.get(key) || [] : [];

    if (useCache && this.cache && !cached.length) {
      try {
        const persisted = await this.cache.getCandles(symbol, interval);
        if (persisted?.length) cached = this._mergeDedupSort([...cached, ...persisted]);
      } catch {
        /* cache is best-effort */
      }
    }

    const intervalMs = INTERVAL_MS[interval];
    const now = Date.now();
    const needFrom = now - count * intervalMs;

    let candles;
    if (cached.length && cached[0].openTime <= needFrom) {
      // We already have enough history cached; just top up the tail.
      const lastOpen = cached[cached.length - 1].openTime;
      // Re-fetch from the last cached candle: it may have been still forming
      // when cached; the newer copy replaces it in _mergeDedupSort.
      const fresh = await this.fetchRange({
        symbol,
        interval,
        startTime: lastOpen,
        endTime: now,
      });
      candles = this._mergeDedupSort([...cached, ...fresh]).slice(-count - 5);
    } else {
      candles = await this.fetchRecent({ symbol, interval, count });
    }

    const window = candles.slice(-count);
    // Validate only the window the analysis will actually use.
    const validation = CandleValidator.validateSeries(window, intervalMs);

    this._memCache.set(key, candles);
    const lastPersist = this._persistAt?.get(key) || 0;
    if (this.cache && Date.now() - lastPersist > 60_000) {
      (this._persistAt ||= new Map()).set(key, Date.now());
      this.cache.putCandles(symbol, interval, candles.slice(-1500)).catch(() => {});
    }

    return { candles: window, validation, fullSeries: candles };
  }

  /**
   * Re-downloads candles for each detected gap and merges them in.
   */
  async healGaps({ symbol, interval, candles, gaps }) {
    const intervalMs = INTERVAL_MS[interval];
    let healed = candles;
    for (const gap of gaps) {
      const refetched = await this.fetchRange({
        symbol,
        interval,
        startTime: gap.fromOpenTime + intervalMs,
        endTime: gap.toOpenTime - intervalMs,
      });
      healed = this._mergeDedupSort([...healed, ...refetched]);
    }
    const validation = CandleValidator.validateSeries(healed, intervalMs);
    return { candles: healed, validation };
  }
}

export const historicalDataEngine = new HistoricalDataEngine();
// Persistent cache is attached lazily in the browser only, so the pure engine
// stays free of browser-only dependencies (and unit-testable in Node).
if (typeof window !== 'undefined') {
  import('../storage/db').then((m) => {
    historicalDataEngine.cache = m.candleCache;
  });
}
