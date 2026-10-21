/**
 * Central, user-editable strategy configuration. Persisted to IndexedDB
 * via lib/storage/db.js (settings store) and editable on /settings.
 */
export const DEFAULT_STRATEGY_CONFIG = {
  version: 'V1.0.0',
  minScore: 70,
  requireHTFAlignment: true,
  requireVolumeConfirmation: true,
  requirePOCInteraction: true,
  requireClosedCandle: true,
  earlyMode: false, // if true, may use the live (unclosed) candle - can repaint
  atrMultiplier: 1.5,
  minRR: 2,
  strategyVariant: 'FULL', // A | B | C | D | FULL (see STRATEGY_VARIANTS)
  stopMethod: 'STRUCTURE_ATR', // STRUCTURE | ATR | STRUCTURE_ATR
  // AUTO (default): the engine derives a real Entry Zone from structure/VP/retest
  // logic — see SignalEngine#_entry(). It is NEVER just "current price" unless
  // that is explicitly what the analysis found (type MARKET_ENTRY / BREAKOUT_ENTRY),
  // and it is labeled as such either way. The other modes force one specific
  // archetype manually, for users who want to override the automatic choice.
  entryMode: 'AUTO', // AUTO | MARKET | POC_RETEST | BREAKOUT | SWING_CONFIRM
  rMultiples: [1, 2, 3],
  gates: {
    maxSpreadPct: 0.15,
    maxAtrPct: 8,
    minAtrPct: 0.03,
    minRelVolume: 0.25,
  },
  riskPercent: 1,
  accountSize: 1000,

  timeframes: {
    htf: '1d', // higher timeframe bias
    mtf: '4h', // execution timeframe
    ltf: '15m', // pullback / entry confirmation
  },

  swing: {
    swingLeftBars: 3,
    swingRightBars: 3,
    minimumSwingDistancePct: 0.05,
    atrFilterMultiplier: 0,
  },

  volumeProfile: {
    binCount: 100,
    valueAreaPct: 0.7,
  },

  // Sums to 100. Multi-timeframe alignment is deliberately NOT a scored
  // component here — it is a hard pass/fail gate instead (requireHTFAlignment
  // below / hard.htf in the engine): conflicting timeframes should block a
  // trade outright, not just cost it a few points.
  weights: {
    marketStructure: 20,
    poc: 15, // Volume Profile (VAH/POC/VAL interaction)
    volume: 15,
    ema: 10,
    rsi: 10,
    macd: 10,
    priceAction: 10, // breakout / retest / confirmation-candle patterns
    atrRisk: 10, // Risk/Reward quality
  },

  scanner: {
    quoteAsset: 'USDT',
    intervalMs: 15000,
    maxSymbols: 60,
  },

  rsi: { period: 14, overbought: 70, oversold: 30 },
  ema: { fast: 20, slow: 50 },

  notifications: {
    telegramEnabled: false,
    telegramBotToken: '',
    telegramChatId: '',
    browserEnabled: true,
    webhookEnabled: false,
    webhookUrl: '',
  },

  signalCooldownMs: 5 * 60 * 1000,

  alerts: {
    // Drives BOTH the in-app "high-score" badge and the server-side cron
    // alert (app/api/cron/scan). minScore here is a CONFLUENCE score
    // threshold, not a win-rate guarantee — check Backtest -> Score Range
    // Analysis for this config's actual historical win rate at this level
    // before trusting it.
    enabled: true,
    minScoreForAlert: 80,
    requireConfirmedState: true,
  },
};

export function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_STRATEGY_CONFIG));
}
