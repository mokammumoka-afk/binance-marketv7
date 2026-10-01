import { getSupabase, ensureUser } from '../supabase/client';

/**
 * Supabase persistence layer — same function surface as
 * lib/storage/indexedDbBackend.js, so lib/storage/db.js can switch
 * between the two without any other file caring which is active.
 *
 * Every call awaits ensureUser() first (anonymous auth), so rows are
 * automatically scoped to the current browser's auth.uid() and the RLS
 * policies in docs/supabase-schema.sql keep one visitor's data invisible
 * to another's. A failed/unavailable Supabase call never throws up into
 * the UI: it's logged to the console and a safe empty/default value is
 * returned, exactly like the IndexedDB backend does when it has no data.
 */

async function withUser() {
  const sb = getSupabase();
  const userId = await ensureUser();
  if (!sb || !userId) return null;
  return { sb, userId };
}

async function safe(label, fn, fallback) {
  try {
    const ctx = await withUser();
    if (!ctx) return fallback;
    return await fn(ctx);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[Supabase] ${label} failed, returning fallback:`, err.message);
    return fallback;
  }
}

// ---- Candle cache ----------------------------------------------------------
export class CandleCache {
  async getCandles(symbol, interval) {
    return safe('getCandles', async ({ sb, userId }) => {
      const { data, error } = await sb
        .from('candles')
        .select('candles')
        .eq('user_id', userId)
        .eq('symbol', symbol.toUpperCase())
        .eq('interval', interval)
        .maybeSingle();
      if (error) throw error;
      return data?.candles || [];
    }, []);
  }

  async putCandles(symbol, interval, candles) {
    return safe('putCandles', async ({ sb, userId }) => {
      const { error } = await sb
        .from('candles')
        .upsert(
          { user_id: userId, symbol: symbol.toUpperCase(), interval, candles, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,symbol,interval' }
        );
      if (error) throw error;
    }, undefined);
  }
}
export const candleCache = new CandleCache();

// ---- Legacy flat signal journal (kept for API parity; unused by the current UI) --
export async function saveSignal(signal) {
  return safe('saveSignal', async ({ sb, userId }) => {
    const { error } = await sb.from('signal_events').insert({
      user_id: userId,
      symbol: signal.symbol,
      ts: Date.now(),
      type: 'JOURNAL_ENTRY',
      note: signal.state,
      state: signal.state,
      score: signal.score,
    });
    if (error) throw error;
  }, undefined);
}

export async function listSignals({ limit = 200, symbol = null } = {}) {
  return safe('listSignals', async ({ sb, userId }) => {
    let q = sb.from('signals').select('*').eq('user_id', userId).order('first_seen', { ascending: false }).limit(limit);
    if (symbol) q = q.eq('symbol', symbol);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }, []);
}

// ---- Paper trading ----------------------------------------------------------
export async function createPaperPosition(position) {
  return safe('createPaperPosition', async ({ sb, userId }) => {
    const row = toSnakePaperPosition(position);
    const { data, error } = await sb
      .from('paper_positions')
      .insert({ ...row, user_id: userId, status: 'OPEN' })
      .select()
      .single();
    if (error) throw error;
    return fromSnakePaperPosition(data);
  }, undefined);
}

export async function updatePaperPosition(id, updates) {
  return safe('updatePaperPosition', async ({ sb, userId }) => {
    const row = toSnakePaperPosition(updates);
    const { error } = await sb.from('paper_positions').update(row).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  }, undefined);
}

export async function listPaperPositions() {
  return safe('listPaperPositions', async ({ sb, userId }) => {
    const { data, error } = await sb.from('paper_positions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromSnakePaperPosition);
  }, []);
}

function toSnakePaperPosition(p) {
  const out = {};
  if ('symbol' in p) out.symbol = p.symbol;
  if ('direction' in p) out.direction = p.direction;
  if ('entry' in p) out.entry = p.entry;
  if ('stopLoss' in p) out.stop_loss = p.stopLoss;
  if ('tp1' in p) out.tp1 = p.tp1;
  if ('tp2' in p) out.tp2 = p.tp2;
  if ('tp3' in p) out.tp3 = p.tp3;
  if ('score' in p) out.score = p.score;
  if ('strategyVersion' in p) out.strategy_version = p.strategyVersion;
  if ('status' in p) out.status = p.status;
  if ('exitPrice' in p) out.exit_price = p.exitPrice;
  if ('result' in p) out.result = p.result;
  if ('rMultiple' in p) out.r_multiple = p.rMultiple;
  if ('closedAt' in p) out.closed_at = p.closedAt ? new Date(p.closedAt).toISOString() : null;
  return out;
}
function fromSnakePaperPosition(r) {
  if (!r) return r;
  return {
    id: r.id,
    symbol: r.symbol,
    direction: r.direction,
    entry: r.entry,
    stopLoss: r.stop_loss,
    tp1: r.tp1,
    tp2: r.tp2,
    tp3: r.tp3,
    score: r.score,
    strategyVersion: r.strategy_version,
    status: r.status,
    exitPrice: r.exit_price,
    result: r.result,
    rMultiple: r.r_multiple,
    createdAt: r.created_at ? Date.parse(r.created_at) : null,
    closedAt: r.closed_at ? Date.parse(r.closed_at) : null,
  };
}

// ---- Settings / strategy config ---------------------------------------------
export async function getSetting(key, fallback = null) {
  return safe('getSetting', async ({ sb, userId }) => {
    const { data, error } = await sb.from('user_settings').select('value').eq('user_id', userId).eq('key', key).maybeSingle();
    if (error) throw error;
    return data ? data.value : fallback;
  }, fallback);
}

export async function setSetting(key, value) {
  return safe('setSetting', async ({ sb, userId }) => {
    const { error } = await sb
      .from('user_settings')
      .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
    if (error) throw error;
  }, undefined);
}

// ---- Watchlist ----------------------------------------------------------
export async function getWatchlist() {
  const v = await getSetting('watchlist', null);
  return v || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
}
export async function setWatchlist(symbols) {
  return setSetting('watchlist', symbols);
}

// ---- System logs ----------------------------------------------------------
export async function logSystemEvent(event) {
  return safe('logSystemEvent', async ({ sb, userId }) => {
    const { error } = await sb.from('system_logs').insert({ user_id: userId, message: event.message, payload: event, timestamp: Date.now() });
    if (error) throw error;
  }, undefined);
}

export async function listSystemLogs(limit = 100) {
  return safe('listSystemLogs', async ({ sb, userId }) => {
    const { data, error } = await sb.from('system_logs').select('*').eq('user_id', userId).order('id', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }, []);
}

// ---- Backtests ----------------------------------------------------------
export async function saveBacktest(result) {
  return safe('saveBacktest', async ({ sb, userId }) => {
    const { error } = await sb.from('backtests').insert({
      user_id: userId,
      symbol: result.symbol,
      interval: result.interval,
      candle_count: result.candleCount,
      metrics: result.metrics,
    });
    if (error) throw error;
  }, undefined);
}

export async function listBacktests() {
  return safe('listBacktests', async ({ sb, userId }) => {
    const { data, error } = await sb.from('backtests').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }, []);
}

// ---- Signal lifecycle records (fingerprint-keyed, append-only history) ------
export async function saveSignalRecord(record) {
  return safe('saveSignalRecord', async ({ sb, userId }) => {
    const row = {
      user_id: userId,
      fingerprint: record.fingerprint,
      symbol: record.symbol,
      timeframe: record.timeframe,
      direction: record.direction,
      state: record.state,
      status: record.status,
      score: record.score,
      entry: record.entry,
      stop_loss: record.stopLoss,
      tp1: record.tp1,
      tp2: record.tp2,
      tp3: record.tp3,
      risk_reward: record.riskReward,
      reasons: record.reasons,
      warnings: record.warnings,
      failed_conditions: record.failedConditions,
      score_breakdown: record.scoreBreakdown,
      indicators: record.indicators,
      structure: record.structure,
      poc: record.poc,
      mtf: record.mtf,
      mode: record.mode,
      strategy_version: record.strategyVersion,
      strategy_variant: record.strategyVariant,
      candle_open_time: record.candleOpenTime,
      data_used_until: record.dataUsedUntil,
      first_seen: record.firstSeen,
      expires_at: record.expiresAt,
      mfe_r: record.mfeR,
      mae_r: record.maeR,
      hits: record.hits,
      result: record.result,
      suppressed_notification: record.suppressedNotification,
      history: record.history,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('signals').upsert(row, { onConflict: 'user_id,fingerprint' });
    if (error) throw error;
  }, undefined);
}

export async function loadSignalRecords() {
  return safe('loadSignalRecords', async ({ sb, userId }) => {
    const { data, error } = await sb.from('signals').select('*').eq('user_id', userId);
    if (error) throw error;
    return (data || []).map(fromSnakeSignalRecord);
  }, []);
}

function fromSnakeSignalRecord(r) {
  return {
    fingerprint: r.fingerprint,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction,
    state: r.state,
    status: r.status,
    score: r.score,
    entry: r.entry,
    stopLoss: r.stop_loss,
    tp1: r.tp1,
    tp2: r.tp2,
    tp3: r.tp3,
    riskReward: r.risk_reward,
    reasons: r.reasons || [],
    warnings: r.warnings || [],
    failedConditions: r.failed_conditions || [],
    scoreBreakdown: r.score_breakdown || {},
    indicators: r.indicators || {},
    structure: r.structure || {},
    poc: r.poc,
    mtf: r.mtf,
    mode: r.mode,
    strategyVersion: r.strategy_version,
    strategyVariant: r.strategy_variant,
    candleOpenTime: r.candle_open_time,
    dataUsedUntil: r.data_used_until,
    firstSeen: r.first_seen,
    expiresAt: r.expires_at,
    mfeR: r.mfe_r || 0,
    maeR: r.mae_r || 0,
    hits: r.hits || { tp1: false, tp2: false, tp3: false, sl: false },
    result: r.result,
    suppressedNotification: r.suppressed_notification,
    history: r.history || [],
  };
}

export async function saveSignalEvent(event) {
  return safe('saveSignalEvent', async ({ sb, userId }) => {
    const { error } = await sb.from('signal_events').insert({
      user_id: userId,
      fingerprint: event.fingerprint,
      symbol: event.symbol,
      ts: event.ts,
      type: event.type,
      note: event.note,
      state: event.state,
      score: event.score,
      candle: event.candle ?? null,
    });
    if (error) throw error;
  }, undefined);
}

export async function listSignalEvents(limit = 300) {
  return safe('listSignalEvents', async ({ sb, userId }) => {
    const { data, error } = await sb.from('signal_events').select('*').eq('user_id', userId).order('ts', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }, []);
}

// ---- Retention policy ----------------------------------------------------
export async function applyRetention({ maxEvents = 5000 } = {}) {
  return safe('applyRetention', async ({ sb, userId }) => {
    const { count, error: countErr } = await sb.from('signal_events').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (countErr) throw countErr;
    if (!count || count <= maxEvents) return;
    const { data: toKeep, error } = await sb
      .from('signal_events')
      .select('id')
      .eq('user_id', userId)
      .order('ts', { ascending: false })
      .limit(maxEvents);
    if (error) throw error;
    const keepIds = new Set((toKeep || []).map((r) => r.id));
    const { data: all } = await sb.from('signal_events').select('id').eq('user_id', userId);
    const deleteIds = (all || []).map((r) => r.id).filter((id) => !keepIds.has(id));
    if (deleteIds.length) await sb.from('signal_events').delete().in('id', deleteIds);
  }, undefined);
}
