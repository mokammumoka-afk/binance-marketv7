/**
 * BinanceRestClient
 * -----------------------------------------------------------------------
 * Thin, dependency-free wrapper around Binance's PUBLIC market-data REST
 * endpoints only. No API key / secret is ever used or required here.
 *
 * Endpoints implemented (per https://developers.binance.com/docs/binance-spot-api-docs/rest-api):
 *   GET /api/v3/ping
 *   GET /api/v3/time
 *   GET /api/v3/exchangeInfo
 *   GET /api/v3/klines
 *   GET /api/v3/uiKlines
 *   GET /api/v3/aggTrades
 *   GET /api/v3/trades
 *   GET /api/v3/depth
 *   GET /api/v3/ticker/24hr
 *   GET /api/v3/ticker/bookTicker
 *   GET /api/v3/ticker/price
 *   GET /api/v3/avgPrice
 *
 * Handles:
 *   - request timeout + JSON validation
 *   - exponential backoff retry on network errors / 5xx
 *   - 429 (rate limit) / 418 (IP ban) with Retry-After honoring
 *   - X-MBX-USED-WEIGHT-1M tracking so callers can self-throttle
 *   - a tiny in-memory request queue so bursts of calls don't fire at once
 */

const PRIMARY_BASE = 'https://api.binance.com';
const FALLBACK_BASE = 'https://data-api.binance.vision';

export class BinanceApiError extends Error {
  constructor(message, { status, code, retryAfter, endpoint } = {}) {
    super(message);
    this.name = 'BinanceApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.endpoint = endpoint;
  }
}

class RequestQueue {
  constructor(concurrency = 4, minIntervalMs = 60) {
    this.concurrency = concurrency;
    this.minIntervalMs = minIntervalMs;
    this.active = 0;
    this.queue = [];
    this.lastDispatch = 0;
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._drain();
    });
  }

  async _drain() {
    if (this.active >= this.concurrency) return;
    const item = this.queue.shift();
    if (!item) return;
    this.active++;
    const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastDispatch));
    if (wait > 0) await sleep(wait);
    this.lastDispatch = Date.now();
    try {
      const result = await item.task();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.active--;
      this._drain();
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BinanceRestClient {
  constructor({ baseUrl = PRIMARY_BASE, fallbackUrl = FALLBACK_BASE, timeoutMs = 10000 } = {}) {
    this.baseUrl = baseUrl;
    this.fallbackUrl = fallbackUrl;
    this.timeoutMs = timeoutMs;
    this.queue = new RequestQueue(4, 60);
    this.usedWeight1m = 0;
    this.lastWeightUpdate = 0;
    this.serverTimeOffsetMs = 0;
  }

  getUsedWeight() {
    return this.usedWeight1m;
  }

  async _fetchOnce(base, path, params, attempt) {
    const url = new URL(base + path);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url.toString(), { signal: controller.signal, cache: 'no-store' });
    } catch (err) {
      clearTimeout(timer);
      throw new BinanceApiError(`Network error calling ${path}: ${err.message}`, { endpoint: path });
    }
    clearTimeout(timer);

    const weightHeader = res.headers.get('x-mbx-used-weight-1m');
    if (weightHeader) {
      this.usedWeight1m = Number(weightHeader);
      this.lastWeightUpdate = Date.now();
    }

    if (res.status === 429 || res.status === 418) {
      const retryAfter = Number(res.headers.get('retry-after') || 1);
      throw new BinanceApiError(
        res.status === 418 ? 'IP auto-banned by Binance (418).' : 'Rate limit exceeded (429).',
        { status: res.status, retryAfter, endpoint: path }
      );
    }

    if (!res.ok) {
      let body;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      throw new BinanceApiError(
        `Binance API error ${res.status} on ${path}: ${body?.msg || res.statusText}`,
        { status: res.status, code: body?.code, endpoint: path }
      );
    }

    try {
      return await res.json();
    } catch (err) {
      throw new BinanceApiError(`Invalid JSON from ${path}: ${err.message}`, { endpoint: path });
    }
  }

  async _request(path, params) {
    return this.queue.run(async () => {
      const maxAttempts = 4;
      let lastErr;
      let base = this.baseUrl;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await this._fetchOnce(base, path, params, attempt);
        } catch (err) {
          lastErr = err;
          if (err instanceof BinanceApiError && (err.status === 429 || err.status === 418)) {
            await sleep((err.retryAfter || 1) * 1000);
            continue;
          }
          if (attempt === 2 && base === this.baseUrl) {
            // Try the vision fallback host once before giving up.
            base = this.fallbackUrl;
          }
          const backoff = Math.min(8000, 300 * 2 ** attempt) + Math.random() * 200;
          await sleep(backoff);
        }
      }
      throw lastErr;
    });
  }

  ping() {
    return this._request('/api/v3/ping', {});
  }

  async serverTime() {
    const data = await this._request('/api/v3/time', {});
    this.serverTimeOffsetMs = data.serverTime - Date.now();
    return data.serverTime;
  }

  exchangeInfo(params = {}) {
    return this._request('/api/v3/exchangeInfo', params);
  }

  klines({ symbol, interval, startTime, endTime, limit = 500 }) {
    return this._request('/api/v3/klines', { symbol, interval, startTime, endTime, limit });
  }

  uiKlines({ symbol, interval, startTime, endTime, limit = 500 }) {
    return this._request('/api/v3/uiKlines', { symbol, interval, startTime, endTime, limit });
  }

  aggTrades({ symbol, fromId, startTime, endTime, limit = 500 }) {
    return this._request('/api/v3/aggTrades', { symbol, fromId, startTime, endTime, limit });
  }

  trades({ symbol, limit = 500 }) {
    return this._request('/api/v3/trades', { symbol, limit });
  }

  depth({ symbol, limit = 100 }) {
    return this._request('/api/v3/depth', { symbol, limit });
  }

  ticker24hr(params = {}) {
    return this._request('/api/v3/ticker/24hr', params);
  }

  bookTicker(params = {}) {
    return this._request('/api/v3/ticker/bookTicker', params);
  }

  tickerPrice(params = {}) {
    return this._request('/api/v3/ticker/price', params);
  }

  avgPrice({ symbol }) {
    return this._request('/api/v3/avgPrice', { symbol });
  }
}

export const binanceRest = new BinanceRestClient();
