import { INTERVAL_MS } from '../data/candle';

/**
 * SignalTracker
 * -----------------------------------------------------------------------
 * Turns the stream of stateless SignalEngine evaluations into stable,
 * de-duplicated signals with a lifecycle:
 *
 *   NEW -> CONFIRMED -> (TP1 | TP2 | TP3 | SL | INVALIDATED | EXPIRED)
 *
 * Guarantees
 *  - FINGERPRINT: the same setup (symbol, timeframe, direction, setup
 *    candle, entry zone, strategy version/variant) is one signal, never
 *    dozens of repeated ones.
 *  - COOLDOWN: a different fingerprint for the same symbol+direction inside
 *    the cooldown window is recorded but not notified.
 *  - REPAINT PROTECTION: history is append-only. A signal that once
 *    appeared is never deleted or rewritten; every change (state, score,
 *    invalidation) is a new history entry with its own timestamp.
 *  - OUTCOME TRACKING: MFE / MAE and TP/SL hits are computed from closed
 *    candles that occurred AFTER the signal candle.
 */

const DIRECTIONAL = new Set(['LONG_CANDIDATE', 'LONG_CONFIRMED', 'SHORT_CANDIDATE', 'SHORT_CONFIRMED']);

export function signalFingerprint(sig) {
  const entry = sig.plan?.entryZone ? (sig.plan.entryZone.low + sig.plan.entryZone.high) / 2 : sig.price;
  const step = sig.indicators?.atr ? sig.indicators.atr * 0.5 : entry * 0.002;
  const zone = Math.round(entry / step);
  return [sig.symbol, sig.timeframe, sig.direction, sig.candleOpenTime, zone, sig.strategyVersion, sig.strategyVariant].join('|');
}

export class SignalTracker {
  constructor({ cooldownMs = 5 * 60_000, expireBars = 24, persist = null } = {}) {
    this.cooldownMs = cooldownMs;
    this.expireBars = expireBars;
    this.persist = persist; // optional { saveRecord(record), saveEvent(event) }
    this.records = new Map(); // fingerprint -> record
    this.lastNotified = new Map(); // symbol|direction -> ts
  }

  hydrate(records = []) {
    for (const r of records) if (r.fingerprint) this.records.set(r.fingerprint, r);
  }

  list() {
    return [...this.records.values()].sort((a, b) => b.firstSeen - a.firstSeen);
  }

  active(symbol = null) {
    return this.list().filter((r) => r.status === 'ACTIVE' && (!symbol || r.symbol === symbol));
  }

  _append(record, type, note, extra = {}) {
    const entry = { ts: Date.now(), type, note, state: record.state, score: record.score, ...extra };
    record.history.push(entry); // append-only
    this.persist?.saveEvent?.({ fingerprint: record.fingerprint, symbol: record.symbol, ...entry });
    this.persist?.saveRecord?.(record);
    return entry;
  }

  /**
   * @param signal  latest SignalEngine result for a symbol
   * @param candles closed candles of the execution timeframe (chronological)
   * @returns array of notifiable events [{type, record, note}]
   */
  update(signal, candles = []) {
    const out = [];
    const symbol = signal.symbol;

    // 1) progress every active record on this symbol using candles AFTER its setup candle
    for (const rec of this.active(symbol)) out.push(...this._progress(rec, candles));

    // 2) register / upgrade the current signal
    if (!DIRECTIONAL.has(signal.state)) return out;
    const fp = signalFingerprint(signal);
    const existing = this.records.get(fp);

    if (existing) {
      if (existing.status !== 'ACTIVE') return out; // finished signals never resurrect
      if (existing.state !== signal.state) {
        const wasCandidate = existing.state.endsWith('CANDIDATE');
        const prev = existing.state;
        existing.state = signal.state;
        existing.score = signal.score;
        this._append(existing, 'STATE_CHANGE', `${prev} -> ${signal.state}`);
        if (wasCandidate && signal.state.endsWith('CONFIRMED')) out.push({ type: 'CONFIRMED', record: existing });
      }
      return out;
    }

    const cdKey = `${symbol}|${signal.direction}`;
    const suppressed = Date.now() - (this.lastNotified.get(cdKey) || 0) < this.cooldownMs;
    const tfMs = INTERVAL_MS[signal.timeframe] || 60_000;
    const record = {
      fingerprint: fp,
      symbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      state: signal.state,
      status: 'ACTIVE',
      score: signal.score,
      entry: signal.plan.entryZone ? (signal.plan.entryZone.low + signal.plan.entryZone.high) / 2 : signal.price,
      stopLoss: signal.plan.stopLoss,
      tp1: signal.plan.tp1,
      tp2: signal.plan.tp2,
      tp3: signal.plan.tp3,
      riskReward: signal.plan.riskRewardToTp1,
      reasons: [...signal.reasons],
      warnings: [...signal.warnings],
      failedConditions: [...signal.failedConditions],
      scoreBreakdown: signal.scoreBreakdown,
      indicators: { rsi: signal.indicators?.rsi, atr: signal.indicators?.atr, ema20: signal.indicators?.ema20, ema50: signal.indicators?.ema50 },
      structure: { regime: signal.structure?.regime, trend: signal.structure?.trend, lastEvent: signal.structure?.lastEvent?.type },
      poc: signal.volumeProfile?.poc?.price,
      mtf: signal.mtf?.overallBias,
      mode: signal.mode,
      strategyVersion: signal.strategyVersion,
      strategyVariant: signal.strategyVariant,
      candleOpenTime: signal.candleOpenTime,
      dataUsedUntil: signal.dataUsedUntil,
      firstSeen: Date.now(),
      expiresAt: Date.now() + this.expireBars * tfMs,
      mfeR: 0,
      maeR: 0,
      hits: { tp1: false, tp2: false, tp3: false, sl: false },
      suppressedNotification: suppressed,
      history: [],
    };
    this.records.set(fp, record);
    this._append(record, 'NEW', `${signal.state} score ${signal.score}`);
    if (!suppressed) {
      this.lastNotified.set(cdKey, Date.now());
      out.push({ type: signal.state.endsWith('CONFIRMED') ? 'CONFIRMED' : 'NEW', record });
    }
    return out;
  }

  _progress(rec, candles) {
    const events = [];
    const isLong = rec.direction === 'LONG';
    const risk = Math.abs(rec.entry - rec.stopLoss) || 1e-12;
    const after = candles.filter((c) => c.openTime > rec.candleOpenTime && c.isClosed !== false);
    const seen = rec._seenUntil || 0;

    for (const c of after) {
      if (c.openTime <= seen) continue;
      rec._seenUntil = c.openTime;
      const fav = isLong ? c.high - rec.entry : rec.entry - c.low;
      const adv = isLong ? rec.entry - c.low : c.high - rec.entry;
      rec.mfeR = Math.max(rec.mfeR, fav / risk);
      rec.maeR = Math.max(rec.maeR, adv / risk);

      const hitSl = isLong ? c.low <= rec.stopLoss : c.high >= rec.stopLoss;
      const hit = (tp) => tp != null && (isLong ? c.high >= tp : c.low <= tp);
      // pessimistic: if SL and a target are inside the same candle, SL first
      if (hitSl) {
        rec.hits.sl = true;
        rec.status = 'CLOSED';
        rec.result = rec.hits.tp1 ? 'TP1_THEN_SL' : 'SL';
        this._append(rec, 'SL', `Stop hit at ${rec.stopLoss}`, { candle: c.openTime });
        events.push({ type: 'SL', record: rec });
        return events;
      }
      for (const [k, tp] of [['tp1', rec.tp1], ['tp2', rec.tp2], ['tp3', rec.tp3]]) {
        if (!rec.hits[k] && hit(tp)) {
          rec.hits[k] = true;
          this._append(rec, k.toUpperCase(), `${k.toUpperCase()} reached at ${tp}`, { candle: c.openTime });
          events.push({ type: k.toUpperCase(), record: rec });
        }
      }
      if (rec.hits.tp3) {
        rec.status = 'CLOSED';
        rec.result = 'TP3';
        return events;
      }
    }

    if (rec.status === 'ACTIVE' && Date.now() > rec.expiresAt) {
      rec.status = 'CLOSED';
      rec.state = 'EXPIRED';
      rec.result = rec.hits.tp2 ? 'TP2' : rec.hits.tp1 ? 'TP1' : 'EXPIRED';
      this._append(rec, 'EXPIRED', 'Signal expired without resolving');
      events.push({ type: 'EXPIRED', record: rec });
    }
    return events;
  }
}
