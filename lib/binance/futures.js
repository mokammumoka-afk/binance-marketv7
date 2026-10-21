/**
 * BinanceFuturesClient
 * -----------------------------------------------------------------------
 * Public, key-free USD-M Futures market-data endpoints only
 * (https://fapi.binance.com). No position/account/order endpoints are
 * called — this client cannot open or close anything on Binance.
 *
 * Used to give Futures-oriented context that spot klines cannot provide:
 * funding rate (cost of holding, crowd positioning), open interest
 * (conviction behind a move), and long/short ratios (contrarian crowding
 * signal). All of this is advisory context, never part of the core
 * confluence score (see lib/futures/futuresContextEngine.js) — it is not
 * validated by the backtester, which only has historical candles.
 */
import { BinanceRestClient, BinanceApiError } from './rest';

const FAPI_BASE = 'https://fapi.binance.com';

export class BinanceFuturesClient extends BinanceRestClient {
  constructor(opts = {}) {
    super({ baseUrl: FAPI_BASE, fallbackUrl: FAPI_BASE, ...opts });
  }

  /** Mark price + funding rate, for one symbol or (symbol omitted) all symbols. */
  premiumIndex(params = {}) {
    return this._request('/fapi/v1/premiumIndex', params);
  }

  fundingRateHistory({ symbol, startTime, endTime, limit = 100 }) {
    return this._request('/fapi/v1/fundingRate', { symbol, startTime, endTime, limit });
  }

  openInterest({ symbol }) {
    return this._request('/fapi/v1/openInterest', { symbol });
  }

  /** period: 5m,15m,30m,1h,2h,4h,6h,12h,1d */
  openInterestHist({ symbol, period = '1h', limit = 30 }) {
    return this._request('/futures/data/openInterestHist', { symbol, period, limit });
  }

  globalLongShortAccountRatio({ symbol, period = '1h', limit = 30 }) {
    return this._request('/futures/data/globalLongShortAccountRatio', { symbol, period, limit });
  }

  topLongShortAccountRatio({ symbol, period = '1h', limit = 30 }) {
    return this._request('/futures/data/topLongShortAccountRatio', { symbol, period, limit });
  }

  topLongShortPositionRatio({ symbol, period = '1h', limit = 30 }) {
    return this._request('/futures/data/topLongShortPositionRatio', { symbol, period, limit });
  }

  takerBuySellVolume({ symbol, period = '1h', limit = 30 }) {
    return this._request('/futures/data/takerlongshortRatio', { symbol, period, limit });
  }

  klines({ symbol, interval, startTime, endTime, limit = 500 }) {
    return this._request('/fapi/v1/klines', { symbol, interval, startTime, endTime, limit });
  }

  exchangeInfo() {
    return this._request('/fapi/v1/exchangeInfo', {});
  }
}

export const binanceFutures = new BinanceFuturesClient();
export { BinanceApiError };

/**
 * One-shot snapshot combining the endpoints the Futures Context Engine
 * needs for a symbol. Any individual call that fails is reported in
 * `errors` instead of throwing — a missing data point degrades gracefully
 * to "unavailable", it never fabricates a funding rate or ratio.
 */
export async function fetchFuturesSnapshot(symbol) {
  const errors = {};
  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors[label] = err.message;
      return null;
    }
  };

  const [premium, oiNow, oiHist, globalRatio, takerRatio] = await Promise.all([
    safe('premiumIndex', () => binanceFutures.premiumIndex({ symbol })),
    safe('openInterest', () => binanceFutures.openInterest({ symbol })),
    safe('openInterestHist', () => binanceFutures.openInterestHist({ symbol, period: '1h', limit: 12 })),
    safe('globalLongShortAccountRatio', () => binanceFutures.globalLongShortAccountRatio({ symbol, period: '1h', limit: 12 })),
    safe('takerBuySellVolume', () => binanceFutures.takerBuySellVolume({ symbol, period: '1h', limit: 12 })),
  ]);

  return {
    symbol,
    fundingRate: premium ? Number(premium.lastFundingRate) : null,
    markPrice: premium ? Number(premium.markPrice) : null,
    indexPrice: premium ? Number(premium.indexPrice) : null,
    nextFundingTime: premium ? premium.nextFundingTime : null,
    openInterest: oiNow ? Number(oiNow.openInterest) : null,
    openInterestHistory: (oiHist || []).map((r) => ({ t: r.timestamp, oi: Number(r.sumOpenInterest) })),
    longShortRatioHistory: (globalRatio || []).map((r) => ({ t: r.timestamp, ratio: Number(r.longShortRatio), longAccount: Number(r.longAccount), shortAccount: Number(r.shortAccount) })),
    takerRatioHistory: (takerRatio || []).map((r) => ({ t: r.timestamp, buySellRatio: Number(r.buySellRatio) })),
    errors: Object.keys(errors).length ? errors : null,
    fetchedAt: Date.now(),
  };
}
