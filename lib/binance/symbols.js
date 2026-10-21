import { binanceRest } from './rest';

/**
 * BinanceSymbolService — discovers real, currently-tradable USDT spot
 * symbols from /api/v3/exchangeInfo. No hard-coded symbol list.
 */
export class BinanceSymbolService {
  constructor(rest = binanceRest) {
    this.rest = rest;
    this._cache = null;
    this._cacheAt = 0;
    this._ttlMs = 60 * 60 * 1000; // exchangeInfo changes rarely; cache 1h
  }

  async getExchangeInfo(force = false) {
    if (!force && this._cache && Date.now() - this._cacheAt < this._ttlMs) {
      return this._cache;
    }
    const info = await this.rest.exchangeInfo();
    this._cache = info;
    this._cacheAt = Date.now();
    return info;
  }

  /**
   * Returns real, active USDT spot symbols: quoteAsset === 'USDT',
   * status === 'TRADING', isSpotTradingAllowed !== false.
   */
  async getUsdtTradingSymbols(force = false) {
    const info = await this.getExchangeInfo(force);
    return info.symbols
      .filter((s) => s.quoteAsset === 'USDT')
      .filter((s) => s.status === 'TRADING')
      .filter((s) => s.isSpotTradingAllowed !== false)
      .map((s) => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        status: s.status,
        pricePrecision: s.quotePrecision,
        baseAssetPrecision: s.baseAssetPrecision,
        filters: s.filters,
      }));
  }

  async getSymbolMeta(symbol, force = false) {
    const symbols = await this.getUsdtTradingSymbols(force);
    return symbols.find((s) => s.symbol === symbol.toUpperCase()) || null;
  }
}

export const symbolService = new BinanceSymbolService();
