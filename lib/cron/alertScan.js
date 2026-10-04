import { signalEngine } from '../signals/signalEngine';
import { signalFingerprint } from '../signals/signalTracker';
import { onlyClosed } from '../data/candle';

/**
 * Evaluates one user's watchlist and returns the signals that cross their
 * alert threshold. Pure-ish: candle loading is injected so this is
 * testable without a network call (see tests/cron.test.mjs).
 *
 * @param {Object} p
 *  config          merged strategy config (incl. config.alerts)
 *  watchlist       string[] symbols
 *  loadCandles     async ({symbol, interval, count}) => { candles, validation }
 *  maxSymbols      cap on symbols evaluated this run (keeps serverless duration bounded)
 */
export async function scanWatchlist({ config, watchlist, loadCandles, maxSymbols = 8 }) {
  const qualifying = [];
  const evaluated = [];
  const symbols = (watchlist || []).slice(0, maxSymbols);

  for (const symbol of symbols) {
    try {
      const tfs = config.timeframes;
      const [htf, mtf, ltf] = await Promise.all([
        loadCandles({ symbol, interval: tfs.htf, count: 220 }),
        loadCandles({ symbol, interval: tfs.mtf, count: 320 }),
        loadCandles({ symbol, interval: tfs.ltf, count: 220 }),
      ]);
      const gapCount = [htf, mtf, ltf].reduce((a, r) => a + (r.validation?.gaps?.length || 0), 0);
      const exec = onlyClosed(mtf.candles);

      const signal = signalEngine.evaluate({
        symbol,
        executionCandles: exec,
        candlesByTf: { [tfs.htf]: onlyClosed(htf.candles), [tfs.mtf]: exec, [tfs.ltf]: onlyClosed(ltf.candles) },
        config,
        dataQuality: { isStale: false, isComplete: gapCount === 0 },
      });

      evaluated.push({ symbol, state: signal.state, score: signal.score });

      const alerts = config.alerts || {};
      if (!alerts.enabled) continue;
      const confirmedOk = !alerts.requireConfirmedState || signal.state.endsWith('CONFIRMED');
      if (signal.direction && confirmedOk && signal.score >= (alerts.minScoreForAlert ?? 80)) {
        qualifying.push({ symbol, signal, fingerprint: signalFingerprint(signal) });
      }
    } catch (err) {
      evaluated.push({ symbol, error: err.message });
    }
  }

  return { qualifying, evaluated };
}

/** Builds the record shape lib/notifications/notify.js#formatEvent expects, from a raw SignalEngine result. */
export function toTrackerRecordShape(signal) {
  return {
    symbol: signal.symbol,
    direction: signal.direction,
    timeframe: signal.timeframe,
    score: signal.score,
    strategyVersion: signal.strategyVersion,
    entry: signal.price,
    stopLoss: signal.plan?.stopLoss,
    tp1: signal.plan?.tp1,
    tp2: signal.plan?.tp2,
    tp3: signal.plan?.tp3,
    riskReward: signal.plan?.riskRewardToTp1,
    reasons: signal.reasons,
    warnings: signal.warnings,
  };
}


/** Validates the caller is an authorized scheduler, not a public crawler. */
export function checkCronSecret({ expectedSecret, headerSecret, querySecret, isVercelCronHeader, isVercelRuntime }) {
  if (!expectedSecret) return { ok: false, reason: 'CRON_SECRET is not set on the server' };
  if (headerSecret === expectedSecret || querySecret === expectedSecret) return { ok: true };
  if (isVercelCronHeader && isVercelRuntime) return { ok: true };
  return { ok: false, reason: 'Secret mismatch' };
}
