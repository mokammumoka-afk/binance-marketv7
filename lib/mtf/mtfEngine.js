import { marketStructureEngine } from '../structure/structureEngine';
import { emaSet, lastReady } from '../indicators';

/**
 * MultiTimeframeEngine — computes a directional bias per timeframe from
 * real structure + EMA alignment (never EMA alone), then combines them
 * into higher-timeframe bias / execution setup / lower-timeframe
 * confirmation, e.g.:
 *   1D BULLISH, 4H BULLISH, 1H BULLISH, 15m PULLBACK, 5m BULLISH CONFIRMATION
 */

function biasForTimeframe(candles) {
  if (!candles || candles.length < 30) return { bias: 'UNKNOWN', reason: 'INSUFFICIENT_DATA' };

  const structure = marketStructureEngine.analyze(candles);
  const emas = emaSet(candles);
  const price = candles[candles.length - 1].close;
  const ema20 = lastReady(emas.ema20);
  const ema50 = lastReady(emas.ema50);

  let structureBias = 'NEUTRAL';
  if (structure.ready) {
    if (structure.regime === 'TREND_BULLISH') structureBias = 'BULLISH';
    else if (structure.regime === 'TREND_BEARISH') structureBias = 'BEARISH';
  }

  let emaBias = 'NEUTRAL';
  if (typeof ema20 === 'number' && typeof ema50 === 'number') {
    if (price > ema20 && ema20 > ema50) emaBias = 'BULLISH';
    else if (price < ema20 && ema20 < ema50) emaBias = 'BEARISH';
  }

  let bias = 'NEUTRAL';
  if (structureBias === 'BULLISH' && emaBias !== 'BEARISH') bias = 'BULLISH';
  else if (structureBias === 'BEARISH' && emaBias !== 'BULLISH') bias = 'BEARISH';
  else if (structureBias === 'NEUTRAL' && emaBias !== 'NEUTRAL') bias = emaBias;
  else bias = 'RANGE';

  return { bias, structureBias, emaBias, structure };
}

export class MultiTimeframeEngine {
  /**
   * @param {Object} candlesByTf { '1d': candles, '4h': candles, '1h': candles, '15m': candles }
   */
  analyze(candlesByTf) {
    const perTf = {};
    for (const [tf, candles] of Object.entries(candlesByTf)) {
      perTf[tf] = biasForTimeframe(candles);
    }

    const tfOrder = Object.keys(candlesByTf);
    const biases = tfOrder.map((tf) => perTf[tf].bias);
    const bullishCount = biases.filter((b) => b === 'BULLISH').length;
    const bearishCount = biases.filter((b) => b === 'BEARISH').length;

    let overallBias = 'MIXED';
    if (bullishCount === tfOrder.length) overallBias = 'BULLISH';
    else if (bearishCount === tfOrder.length) overallBias = 'BEARISH';
    else if (bullishCount >= Math.ceil(tfOrder.length * 0.66)) overallBias = 'MOSTLY_BULLISH';
    else if (bearishCount >= Math.ceil(tfOrder.length * 0.66)) overallBias = 'MOSTLY_BEARISH';

    const alignmentScore = tfOrder.length ? Math.max(bullishCount, bearishCount) / tfOrder.length : 0;

    return {
      perTimeframe: perTf,
      overallBias,
      alignmentScore, // 0..1
      alignedCount: Math.max(bullishCount, bearishCount),
      totalTimeframes: tfOrder.length,
    };
  }
}

export const mtfEngine = new MultiTimeframeEngine();
