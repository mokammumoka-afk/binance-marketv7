import { NextResponse } from 'next/server';
import { historicalDataEngine } from '../../../../lib/binance/historical';
import { cloneDefaultConfig } from '../../../../lib/config/strategyConfig';
import { scanWatchlist, toTrackerRecordShape, checkCronSecret } from '../../../../lib/cron/alertScan';
import { sendTelegramMessage, sendWebhook, formatEvent } from '../../../../lib/notifications/notify';
import { sendWebPushToMany, webPushEnabled } from '../../../../lib/notifications/webPush';
import { getServiceRoleClient, serviceRoleConfigured } from '../../../../lib/supabase/serverClient';

// This route is meant to be hit on a schedule by something OUTSIDE the
// user's browser (Vercel Cron, GitHub Actions, cron-job.org — see
// README "Alerts that work with the browser closed"). It never requires
// anyone to have the app open.
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds; the actual cap depends on your Vercel plan — see README

function loadCandles({ symbol, interval, count }) {
  return historicalDataEngine.load({ symbol, interval, count });
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
  return out;
}

function checkSecret(request) {
  return checkCronSecret({
    expectedSecret: process.env.CRON_SECRET,
    headerSecret: request.headers.get('x-cron-secret'),
    querySecret: new URL(request.url).searchParams.get('secret'),
    isVercelCronHeader: !!request.headers.get('x-vercel-cron'), // present on Vercel's own Cron Job invocations
    isVercelRuntime: !!process.env.VERCEL,
  });
}

/** Single-tenant fallback: works with zero Supabase setup, config entirely from env vars. */
async function runEnvFallback() {
  const symbols = (process.env.CRON_SYMBOLS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!symbols.length) return { ran: false, reason: 'CRON_SYMBOLS not set' };

  const config = cloneDefaultConfig();
  config.alerts.minScoreForAlert = Number(process.env.CRON_MIN_SCORE || config.alerts.minScoreForAlert);

  const { qualifying, evaluated } = await scanWatchlist({ config, watchlist: symbols, loadCandles, maxSymbols: symbols.length });

  const notifications = {
    telegramEnabled: !!process.env.CRON_TELEGRAM_BOT_TOKEN,
    telegramBotToken: process.env.CRON_TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.CRON_TELEGRAM_CHAT_ID,
    webhookEnabled: !!process.env.CRON_WEBHOOK_URL,
    webhookUrl: process.env.CRON_WEBHOOK_URL,
  };

  const sent = [];
  for (const q of qualifying) {
    const ev = { type: q.signal.state.endsWith('CONFIRMED') ? 'CONFIRMED' : 'NEW', record: toTrackerRecordShape(q.signal) };
    const text = formatEvent(ev, 'en');
    const results = {};
    if (notifications.telegramEnabled) {
      results.telegram = await sendTelegramMessage({ botToken: notifications.telegramBotToken, chatId: notifications.telegramChatId, text }).then(() => 'ok').catch((e) => e.message);
    }
    if (notifications.webhookEnabled) {
      results.webhook = await sendWebhook(notifications.webhookUrl, { type: ev.type, signal: q.signal }).then(() => 'ok').catch((e) => e.message);
    }
    sent.push({ symbol: q.symbol, fingerprint: q.fingerprint, results });
  }

  return { ran: true, mode: 'env-fallback', evaluated, qualifying: qualifying.length, sent, dedupeWarning: 'No Supabase configured: duplicate alerts are possible across cron runs until the signal state changes. Configure Supabase for proper dedupe.' };
}

/** Multi-user mode: reads every opted-in user's config/watchlist/subscriptions via the service-role key. */
async function runSupabaseUsers() {
  const sb = getServiceRoleClient();
  if (!sb) return { ran: false, reason: 'SUPABASE_SERVICE_ROLE_KEY not set' };

  const { data: settingRows, error } = await sb.from('user_settings').select('user_id, key, value').in('key', ['strategyConfig', 'watchlist']);
  if (error) return { ran: false, reason: `Supabase query failed: ${error.message}` };

  const byUser = new Map();
  for (const row of settingRows || []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, {});
    byUser.get(row.user_id)[row.key] = row.value;
  }

  const maxUsers = Number(process.env.CRON_MAX_USERS || 25);
  const userIds = [...byUser.keys()].slice(0, maxUsers);
  const results = [];

  for (const userId of userIds) {
    const stored = byUser.get(userId);
    const config = deepMerge(cloneDefaultConfig(), stored.strategyConfig || {});
    const watchlist = stored.watchlist || [];
    if (!config.alerts?.enabled || !watchlist.length) continue;

    const { qualifying, evaluated } = await scanWatchlist({ config, watchlist, loadCandles, maxSymbols: Number(process.env.CRON_MAX_SYMBOLS_PER_USER || 8) });
    if (!qualifying.length) {
      results.push({ userId, evaluated, sent: [] });
      continue;
    }

    // Dedupe against previously-notified, still-active fingerprints.
    const fingerprints = qualifying.map((q) => q.fingerprint);
    const { data: already } = await sb.from('signals').select('fingerprint').eq('user_id', userId).in('fingerprint', fingerprints).not('notified_at', 'is', null);
    const alreadyNotified = new Set((already || []).map((r) => r.fingerprint));

    const toNotify = qualifying.filter((q) => !alreadyNotified.has(q.fingerprint));
    const sent = [];

    if (toNotify.length) {
      const { data: subs } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
      const pushSubs = (subs || []).map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }));

      for (const q of toNotify) {
        const record = toTrackerRecordShape(q.signal);
        const ev = { type: q.signal.state.endsWith('CONFIRMED') ? 'CONFIRMED' : 'NEW', record };
        const text = formatEvent(ev, config.lang === 'ar' ? 'ar' : 'en');
        const channelResults = {};

        const n = config.notifications || {};
        if (n.telegramEnabled) {
          channelResults.telegram = await sendTelegramMessage({ botToken: n.telegramBotToken, chatId: n.telegramChatId, text }).then(() => 'ok').catch((e) => e.message);
        }
        if (n.webhookEnabled && n.webhookUrl) {
          channelResults.webhook = await sendWebhook(n.webhookUrl, { type: ev.type, signal: q.signal }).then(() => 'ok').catch((e) => e.message);
        }
        if (webPushEnabled() && pushSubs.length) {
          const pushResults = await sendWebPushToMany(pushSubs, {
            title: `${record.symbol} — ${q.signal.state.replace(/_/g, ' ')}`,
            body: `Score ${record.score}/100 · ${record.reasons?.[0] || ''}`,
            url: `/analyzer?symbol=${record.symbol}`,
            tag: q.fingerprint,
          });
          channelResults.webPush = pushResults.map((r) => (r.ok ? 'ok' : r.error)).join('; ');

          const expired = pushSubs.filter((_, i) => pushResults[i]?.expired).map((s) => s.endpoint);
          if (expired.length) await sb.from('push_subscriptions').delete().eq('user_id', userId).in('endpoint', expired);
        }

        await sb.from('signals').upsert(
          {
            user_id: userId,
            fingerprint: q.fingerprint,
            symbol: record.symbol,
            timeframe: record.timeframe,
            direction: record.direction,
            state: q.signal.state,
            status: 'ACTIVE',
            score: record.score,
            entry: record.entry,
            stop_loss: record.stopLoss,
            tp1: record.tp1,
            tp2: record.tp2,
            tp3: record.tp3,
            risk_reward: record.riskReward,
            reasons: record.reasons,
            warnings: record.warnings,
            strategy_version: record.strategyVersion,
            candle_open_time: q.signal.candleOpenTime,
            first_seen: Date.now(),
            notified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,fingerprint' }
        );

        sent.push({ symbol: q.symbol, fingerprint: q.fingerprint, results: channelResults });
      }
    }

    results.push({ userId, evaluated, sent, skippedAsAlreadyNotified: qualifying.length - toNotify.length });
  }

  return { ran: true, mode: 'supabase-users', usersProcessed: userIds.length, results };
}

export async function GET(request) {
  const auth = checkSecret(request);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized', reason: auth.reason }, { status: 401 });

  const [envResult, supabaseResult] = await Promise.all([
    runEnvFallback().catch((err) => ({ ran: false, reason: err.message })),
    serviceRoleConfigured ? runSupabaseUsers().catch((err) => ({ ran: false, reason: err.message })) : Promise.resolve({ ran: false, reason: 'not configured' }),
  ]);

  return NextResponse.json({ ok: true, timestamp: Date.now(), envFallback: envResult, supabaseUsers: supabaseResult });
}
