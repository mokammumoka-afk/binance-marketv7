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
  entryMode: 'CLOSE', // CLOSE | POC_RETEST | BREAKOUT | SWING_CONFIRM
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

  weights: {
    marketStructure: 20,
    poc: 20,
    volume: 15,
    priceAction: 15,
    mtfConfirmation: 10,
    ema: 5,
    rsi: 5,
    atrRisk: 10,
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
