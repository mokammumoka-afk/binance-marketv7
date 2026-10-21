import { binanceRest } from '../binance/rest';
import { symbolService } from '../binance/symbols';
import { historicalDataEngine } from '../binance/historical';
import { signalEngine } from '../signals/signalEngine';
import { lastReady, rsi } from '../indicators';

/**
 * ScannerService — real market scanner, no invented rows.
 *  - symbols come from exchangeInfo (USDT, TRADING, spot allowed)
 *  - ONE batched /ticker/24hr call and ONE batched /ticker/bookTicker call
 *    per scan (never a request per symbol per second)
 *  - deep analysis (full SignalEngine) runs progressively on the most liquid
 *    symbols and the watchlist, reusing cached candles (incremental top-up)
 */
export class ScannerService {
  async snapshot({ watchlist = [], limit = 120 } = {}) {
    const [symbols, tickers, books] = await Promise.all([
      symbolService.getUsdtTradingSymbols(),
      binanceRest.ticker24hr(),
      binanceRest.bookTicker(),
    ]);
    const tick = new Map(tickers.map((t) => [t.symbol, t]));
    const book = new Map(books.map((b) => [b.symbol, b]));
    const wl = new Set(watchlist);
    const rows = symbols
      .map((s) => {
        const t = tick.get(s.symbol);
        if (!t) return null;
        const b = book.get(s.symbol);
        const bid = Number(b?.bidPrice);
        const ask = Number(b?.askPrice);
        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          price: Number(t.lastPrice),
          change24h: Number(t.priceChangePercent),
          high24h: Number(t.highPrice),
          low24h: Number(t.lowPrice),
          volume24h: Number(t.quoteVolume),
          trades24h: Number(t.count),
          spreadPct: bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null,
          isWatchlisted: wl.has(s.symbol),
          updatedAt: Date.now(),
        };
      })
      .filter((r) => r && r.volume24h > 0)
      .sort((a, b) => Number(b.isWatchlisted) - Number(a.isWatchlisted) || b.volume24h - a.volume24h);
    return rows.slice(0, limit);
  }

  async evaluateSymbol(symbol, config, { spreadPct = null, wsQuality = null } = {}) {
    const tfs = config.timeframes;
    const load = (interval, count) => historicalDataEngine.load({ symbol, interval, count });
    const [htf, mtf, ltf] = await Promise.all([load(tfs.htf, 220), load(tfs.mtf, 320), load(tfs.ltf, 220)]);
    const gapCount = [htf, mtf, ltf].reduce((a, r) => a + r.validation.gaps.length, 0);
    const dataQuality = {
      isStale: wsQuality?.isStale ?? false,
      isComplete: gapCount === 0,
      state: wsQuality?.state,
      spreadPct,
    };
    const signal = signalEngine.evaluate({
      symbol,
      executionCandles: mtf.candles,
      candlesByTf: { [tfs.htf]: htf.candles, [tfs.mtf]: mtf.candles, [tfs.ltf]: ltf.candles },
      config,
      dataQuality,
    });
    return { signal, candles: mtf.candles, gapCount };
  }

  /**
   * Progressive deep scan. Calls onRow(row) as each symbol finishes so the UI
   * fills in live instead of waiting for the slowest symbol.
   */
  async deepScan(rows, config, { max = 20, tracker = null, onRow, signalOnly = false } = {}) {
    const out = [];
    for (const row of rows.slice(0, max)) {
      try {
        const { signal, candles } = await this.evaluateSymbol(row.symbol, config, { spreadPct: row.spreadPct });
        const events = tracker ? tracker.update(signal, candles) : [];
        const deep = {
          ...row,
          signal,
          state: signal.state,
          direction: signal.direction,
          score: signal.score,
          regime: signal.structure?.regime,
          lastStructureEvent: signal.structure?.lastEvent?.type,
          pocDistancePct: signal.pocInteraction?.distancePct ?? null,
          rsi: signal.indicators?.rsiReady ? signal.indicators.rsi : null,
          atrPct: signal.atrPct ?? null,
          relVolume: signal.volume?.lastRelativeVolume ?? null,
          mtfBias: signal.mtf?.overallBias,
          analyzedAt: Date.now(),
        };
        out.push({ deep, events });
        onRow?.(deep, events);
      } catch (err) {
        onRow?.({ ...row, error: err.message }, []);
      }
    }
    return out;
  }

  quickRsi(candles) {
    return lastReady(rsi(candles, 14));
  }
}

export const scannerService = new ScannerService();
