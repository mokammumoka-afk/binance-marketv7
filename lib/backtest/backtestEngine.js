import { signalEngine, STRATEGY_VARIANTS } from '../signals/signalEngine';
import { INTERVAL_MS, resampleByTime } from '../data/candle';

/**
 * BacktestEngine
 * -----------------------------------------------------------------------
 * Two stages, both strictly causal (NO LOOK-AHEAD BIAS):
 *
 *  1. precompute(): walks the real historical candles forward. At step i the
 *     SignalEngine receives ONLY candles[0..i]. Higher timeframes are built
 *     from those same candles aligned to wall-clock boundaries; a higher
 *     timeframe candle that is still forming is marked not-closed and the
 *     engine's closed-candle policy drops it. Swings, POC, volume profile
 *     and structure are therefore all computed from data known at time i.
 *
 *  2. simulate(): turns the recorded signals into trades. Entry is the OPEN
 *     of the candle AFTER the signal candle (a closed-candle signal cannot
 *     be filled at its own close). If SL and a target are inside the same
 *     candle, the stop is assumed to hit first (pessimistic). Fees are
 *     charged as R. Positions are scaled out at TP1/TP2/TP3 and the stop
 *     moves to break-even after TP1 (configurable).
 *
 * Because thresholds (min score, min R:R, required conditions) are applied
 * in simulate(), walk-forward / sensitivity / Monte Carlo can re-run
 * thousands of variations without recomputing the expensive analysis.
 */

const ORDER = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

export function chooseHigherTimeframes(execInterval) {
  const ms = INTERVAL_MS[execInterval];
  const higher = ORDER.filter((tf) => INTERVAL_MS[tf] >= ms * 3);
  return [higher[1] || higher[0] || execInterval, higher[0] || execInterval].filter(Boolean); // [htf, mtf]
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export class BacktestEngine {
  /**
   * Stage 1 — causal signal generation.
   * @returns {Promise<{signals: Array, warnings: string[], meta: Object}>}
   */
  async precompute({ symbol, candles, execInterval, config, stride = 1, minWarmup = null, onProgress }) {
    const execMs = INTERVAL_MS[execInterval];
    const [htf, mtf] = chooseHigherTimeframes(execInterval);
    const htfMs = INTERVAL_MS[htf];
    const mtfMs = INTERVAL_MS[mtf];
    const warnings = [];

    const needHtf = Math.ceil((35 * htfMs) / execMs);
    const warm = minWarmup ?? Math.max(340, needHtf + 20);
    if (candles.length < warm + 50) {
      warnings.push(`Only ${candles.length} candles: ${warm} are needed as warm-up for ${htf} bias. Load more candles.`);
      return { signals: [], warnings, meta: { htf, mtf, warm } };
    }

    // permissive engine config: gating is applied later in simulate()
    const cfg = {
      ...config,
      minScore: 0,
      minRR: config.minRR,
      requireHTFAlignment: false,
      requireVolumeConfirmation: false,
      requirePOCInteraction: false,
      earlyMode: false,
      timeframes: { htf, mtf, ltf: execInterval },
    };

    const signals = [];
    for (let i = warm; i < candles.length - 1; i += stride) {
      const causal = candles.slice(Math.max(0, i - 1200), i + 1); // only known data
      const htfWindow = causal.slice(-Math.ceil((80 * htfMs) / execMs));
      const mtfWindow = causal.slice(-Math.ceil((80 * mtfMs) / execMs));
      const result = signalEngine.evaluate({
        symbol,
        executionCandles: causal.slice(-400),
        candlesByTf: {
          [htf]: resampleByTime(htfWindow, htfMs),
          [mtf]: resampleByTime(mtfWindow, mtfMs),
          [execInterval]: causal.slice(-150),
        },
        config: { ...cfg, timeframes: { htf, mtf, ltf: execInterval } },
        dataQuality: { isStale: false, isComplete: true },
      });
      if (result.state !== 'NO_TRADE' && result.direction && result.plan) {
        signals.push({
          i,
          direction: result.direction,
          score: result.score,
          hard: result.hard,
          sl: result.plan.stopLoss,
          tps: [result.plan.tp1, result.plan.tp2, result.plan.tp3],
          rr: result.plan.riskRewardToTp1,
          openTime: candles[i].openTime,
        });
      }
      if (i % 40 === 0) {
        onProgress?.({ index: i, total: candles.length });
        await tick(); // keep the UI responsive
      }
    }
    return { signals, warnings, meta: { htf, mtf, warm, execInterval } };
  }

  /** Stage 2 — trade simulation over recorded signals with given thresholds. */
  simulate(candles, signals, opts = {}) {
    const {
      minScore = 70,
      minRR = 2,
      requireHTF = true,
      requireVolume = true,
      requirePOC = true,
      partials = [0.34, 0.33, 0.33],
      moveToBreakEven = true,
      feeBps = 7.5, // per side (Binance spot taker ~7.5 bps with BNB discount)
      maxHoldBars = 96,
      from = 0,
      to = Infinity,
    } = opts;

    const trades = [];
    let busyUntil = -1;

    for (const s of signals) {
      if (s.i < from || s.i >= to || s.i <= busyUntil) continue;
      if (s.score < minScore) continue;
      if (typeof s.rr !== 'number' || s.rr < minRR) continue;
      if (requireHTF && !s.hard.htf) continue;
      if (requireVolume && !s.hard.volume) continue;
      if (requirePOC && !s.hard.poc) continue;

      const fillIdx = s.i + 1;
      if (fillIdx >= candles.length) break;
      const trade = this._manage(candles, fillIdx, s, { partials, moveToBreakEven, feeBps, maxHoldBars });
      if (!trade) continue;
      trades.push(trade);
      busyUntil = trade.exitIndex;
    }
    return { trades, metrics: this.computeMetrics(trades) };
  }

  _manage(candles, fillIdx, s, { partials, moveToBreakEven, feeBps, maxHoldBars }) {
    const isLong = s.direction === 'LONG';
    const entry = candles[fillIdx].open;
    let sl = s.sl;
    const risk = Math.abs(entry - sl);
    if (!(risk > 0)) return null;
    if (isLong ? sl >= entry : sl <= entry) return null; // gap through the stop before fill
    const tps = s.tps.filter((t) => t != null);
    if (!tps.length || (isLong ? tps[0] <= entry : tps[0] >= entry)) return null;

    const rOf = (price) => (isLong ? price - entry : entry - price) / risk;
    let remaining = 1;
    let realized = 0;
    let mfe = 0;
    let mae = 0;
    let reached = 0;
    let exitIndex = fillIdx;
    let exitPrice = entry;
    let result = null;
    let beActive = false;

    for (let j = fillIdx; j < candles.length && j - fillIdx <= maxHoldBars; j++) {
      const c = candles[j];
      exitIndex = j;
      mfe = Math.max(mfe, rOf(isLong ? c.high : c.low));
      mae = Math.min(mae, rOf(isLong ? c.low : c.high));

      const stopHit = isLong ? c.low <= sl : c.high >= sl;
      if (stopHit) {
        realized += remaining * rOf(sl);
        exitPrice = sl;
        result = reached ? (beActive && sl === entry ? `TP${reached}_THEN_BE` : `TP${reached}_THEN_SL`) : 'SL';
        remaining = 0;
        break;
      }
      let advanced = false;
      while (reached < tps.length && (isLong ? c.high >= tps[reached] : c.low <= tps[reached])) {
        const part = Math.min(remaining, partials[reached] ?? remaining);
        realized += part * rOf(tps[reached]);
        remaining -= part;
        exitPrice = tps[reached];
        reached += 1;
        advanced = true;
      }
      if (advanced && moveToBreakEven && reached === 1) {
        sl = entry; // effective from the next candle (conservative)
        beActive = true;
      }
      if (remaining <= 1e-9 || reached >= tps.length) {
        remaining = 0;
        result = `TP${reached}`;
        break;
      }
    }
    if (remaining > 1e-9) {
      const c = candles[exitIndex];
      realized += remaining * rOf(c.close);
      exitPrice = c.close;
      result = reached ? `TP${reached}_THEN_TIMEOUT` : 'TIMEOUT';
    }
    const feeR = ((2 * feeBps) / 10000 * entry) / risk;
    const r = realized - feeR;
    return {
      direction: s.direction,
      score: s.score,
      entryIndex: fillIdx,
      exitIndex,
      entryPrice: entry,
      exitPrice,
      stopLoss: s.sl,
      tp1: tps[0],
      tp2: tps[1],
      tp3: tps[2],
      result,
      tpReached: reached,
      r,
      feeR,
      mfeR: mfe,
      maeR: mae,
      bars: exitIndex - fillIdx + 1,
      entryTime: candles[fillIdx].openTime,
      exitTime: candles[exitIndex].closeTime,
    };
  }

  computeMetrics(trades, { barMs = null } = {}) {
    const total = trades.length;
    const wins = trades.filter((t) => t.r > 0);
    const losses = trades.filter((t) => t.r <= 0);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const grossWin = sum(wins.map((t) => t.r));
    const grossLoss = Math.abs(sum(losses.map((t) => t.r)));
    const rs = trades.map((t) => t.r);
    const mean = total ? sum(rs) / total : 0;
    const sd = total > 1 ? Math.sqrt(sum(rs.map((x) => (x - mean) ** 2)) / (total - 1)) : 0;
    const downside = total ? Math.sqrt(sum(rs.map((x) => Math.min(0, x) ** 2)) / total) : 0;

    let peak = 0;
    let run = 0;
    let maxDD = 0;
    let cw = 0;
    let cl = 0;
    let maxCW = 0;
    let maxCL = 0;
    for (const t of trades) {
      run += t.r;
      peak = Math.max(peak, run);
      maxDD = Math.max(maxDD, peak - run);
      if (t.r > 0) {
        cw++;
        cl = 0;
      } else {
        cl++;
        cw = 0;
      }
      maxCW = Math.max(maxCW, cw);
      maxCL = Math.max(maxCL, cl);
    }
    const dir = (d) => trades.filter((t) => t.direction === d);
    const rate = (fn) => (total ? trades.filter(fn).length / total : 0);
    return {
      totalTrades: total,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: total ? wins.length / total : 0,
      avgWinR: wins.length ? grossWin / wins.length : 0,
      avgLossR: losses.length ? -grossLoss / losses.length : 0,
      profitFactor: grossLoss ? grossWin / grossLoss : total ? Infinity : 0,
      expectancyR: mean,
      netR: sum(rs),
      avgR: mean,
      maxDrawdownR: maxDD,
      maxConsecutiveWins: maxCW,
      maxConsecutiveLosses: maxCL,
      sharpeLike: sd ? mean / sd : 0, // per-trade, not annualised
      sortinoLike: downside ? mean / downside : 0,
      tp1HitRate: rate((t) => t.tpReached >= 1),
      tp2HitRate: rate((t) => t.tpReached >= 2),
      tp3HitRate: rate((t) => t.tpReached >= 3),
      slRate: rate((t) => t.result === 'SL'),
      avgHoldingBars: total ? sum(trades.map((t) => t.bars)) / total : 0,
      avgHoldingMs: total && barMs ? (sum(trades.map((t) => t.bars)) / total) * barMs : null,
      long: { trades: dir('LONG').length, netR: sum(dir('LONG').map((t) => t.r)), winRate: dir('LONG').length ? dir('LONG').filter((t) => t.r > 0).length / dir('LONG').length : 0 },
      short: { trades: dir('SHORT').length, netR: sum(dir('SHORT').map((t) => t.r)), winRate: dir('SHORT').length ? dir('SHORT').filter((t) => t.r > 0).length / dir('SHORT').length : 0 },
    };
  }

  /** Does a higher score actually mean better results? (spec section 39) */
  scoreBucketAnalysis(trades) {
    const edges = [
      ['50-59', 50, 60],
      ['60-69', 60, 70],
      ['70-79', 70, 80],
      ['80-89', 80, 90],
      ['90-100', 90, 101],
    ];
    const out = {};
    for (const [name, lo, hi] of edges) {
      const b = trades.filter((t) => t.score >= lo && t.score < hi);
      out[name] = {
        trades: b.length,
        winRate: b.length ? b.filter((t) => t.r > 0).length / b.length : null,
        expectancyR: b.length ? b.reduce((a, t) => a + t.r, 0) / b.length : null,
        netR: b.reduce((a, t) => a + t.r, 0),
      };
    }
    return out;
  }

  /** Aggregate metrics across several {symbol, timeframe, trades} runs. */
  aggregate(runs) {
    const all = runs.flatMap((r) => r.trades.map((t) => ({ ...t, symbol: r.symbol, timeframe: r.timeframe })));
    const group = (keyFn) => {
      const m = new Map();
      for (const t of all) {
        const k = keyFn(t);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(t);
      }
      return Object.fromEntries([...m].map(([k, v]) => [k, this.computeMetrics(v)]));
    };
    return { overall: this.computeMetrics(all), bySymbol: group((t) => t.symbol), byTimeframe: group((t) => t.timeframe), byScore: this.scoreBucketAnalysis(all) };
  }

  /**
   * Monte Carlo trade-order reshuffling (seeded => reproducible).
   * Shows how much of the historical drawdown was luck of ordering.
   */
  monteCarlo(trades, { iterations = 1000, seed = 12345 } = {}) {
    const rs = trades.map((t) => t.r);
    if (rs.length < 5) return { ready: false, reason: 'Need at least 5 trades' };
    const rand = mulberry32(seed);
    const dds = [];
    const finals = [];
    for (let k = 0; k < iterations; k++) {
      const a = rs.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      let run = 0;
      let peak = 0;
      let dd = 0;
      for (const x of a) {
        run += x;
        peak = Math.max(peak, run);
        dd = Math.max(dd, peak - run);
      }
      dds.push(dd);
      finals.push(run);
    }
    dds.sort((x, y) => x - y);
    finals.sort((x, y) => x - y);
    return {
      ready: true,
      iterations,
      maxDrawdownR: { p50: percentile(dds, 50), p95: percentile(dds, 95), p99: percentile(dds, 99) },
      finalR: { p5: percentile(finals, 5), p50: percentile(finals, 50), p95: percentile(finals, 95) },
      probabilityNegative: finals.filter((x) => x < 0).length / finals.length,
    };
  }

  /**
   * Sensitivity analysis: how does expectancy move when each threshold is
   * nudged? A strategy that only works at one exact setting is overfit.
   */
  sensitivity(candles, signals, base = {}) {
    const grid = [];
    const scores = [50, 60, 70, 80, 90];
    const rrs = [1, 1.5, 2, 2.5, 3];
    for (const minScore of scores) {
      for (const minRR of rrs) {
        const { metrics } = this.simulate(candles, signals, { ...base, minScore, minRR });
        grid.push({ minScore, minRR, trades: metrics.totalTrades, expectancyR: metrics.expectancyR, netR: metrics.netR, profitFactor: metrics.profitFactor });
      }
    }
    const usable = grid.filter((g) => g.trades >= 5);
    const positive = usable.filter((g) => g.expectancyR > 0).length;
    return {
      grid,
      usableCells: usable.length,
      positiveCells: positive,
      parameterStability: usable.length ? positive / usable.length : null,
      note: 'Stability = share of neighbouring threshold settings (with >=5 trades) that stay profitable.',
    };
  }

  /**
   * Rolling walk-forward: for each window, pick the best thresholds on the
   * TRAIN segment, confirm on VALIDATION, and report on the untouched TEST
   * segment. Degradation from train to test is the overfitting signal.
   */
  walkForward(candles, signals, { trainBars, validationBars, testBars, base = {}, minTrainTrades = 8 } = {}) {
    const windows = [];
    const scores = [60, 70, 80];
    const rrs = [1.5, 2, 3];
    for (let start = 0; start + trainBars + validationBars + testBars <= candles.length; start += testBars) {
      const t0 = start;
      const t1 = start + trainBars;
      const v1 = t1 + validationBars;
      const e1 = v1 + testBars;
      let best = null;
      for (const minScore of scores) {
        for (const minRR of rrs) {
          const tr = this.simulate(candles, signals, { ...base, minScore, minRR, from: t0, to: t1 }).metrics;
          if (tr.totalTrades < minTrainTrades) continue;
          if (!best || tr.expectancyR > best.train.expectancyR) best = { minScore, minRR, train: tr };
        }
      }
      if (!best) {
        windows.push({ range: [t0, e1], skipped: true, reason: 'Not enough trades in the training segment' });
        continue;
      }
      const opts = { ...base, minScore: best.minScore, minRR: best.minRR };
      const validation = this.simulate(candles, signals, { ...opts, from: t1, to: v1 }).metrics;
      const test = this.simulate(candles, signals, { ...opts, from: v1, to: e1 });
      windows.push({ range: [t0, e1], params: { minScore: best.minScore, minRR: best.minRR }, train: best.train, validation, test: test.metrics, testTrades: test.trades });
    }
    const done = windows.filter((w) => !w.skipped);
    const testTrades = done.flatMap((w) => w.testTrades);
    const avg = (fn) => (done.length ? done.reduce((a, w) => a + fn(w), 0) / done.length : null);
    const trainExp = avg((w) => w.train.expectancyR);
    const testExp = avg((w) => w.test.expectancyR);
    return {
      windows,
      outOfSample: this.computeMetrics(testTrades),
      avgTrainExpectancyR: trainExp,
      avgTestExpectancyR: testExp,
      degradation: trainExp != null && testExp != null ? trainExp - testExp : null,
      verdict:
        done.length === 0
          ? 'INSUFFICIENT_DATA'
          : testExp > 0 && trainExp - testExp < Math.max(0.15, Math.abs(trainExp) * 0.6)
          ? 'HOLDS_OUT_OF_SAMPLE'
          : 'DEGRADES_OUT_OF_SAMPLE',
    };
  }

  /** Strategy A/B/C/D/FULL comparison to measure what each condition adds. */
  async compareVariants({ symbol, candles, execInterval, config, simOpts = {}, onProgress }) {
    const out = {};
    for (const key of Object.keys(STRATEGY_VARIANTS)) {
      const pre = await this.precompute({
        symbol,
        candles,
        execInterval,
        config: { ...config, strategyVariant: key },
        onProgress: (p) => onProgress?.({ variant: key, ...p }),
      });
      out[key] = { label: STRATEGY_VARIANTS[key].label, ...this.simulate(candles, pre.signals, { ...simOpts, minScore: config.minScore, minRR: config.minRR }), warnings: pre.warnings };
    }
    return out;
  }
}

export const backtestEngine = new BacktestEngine();
