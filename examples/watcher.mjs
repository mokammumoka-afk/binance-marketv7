#!/usr/bin/env node
/**
 * Standalone 24/7 watcher — an alternative to the Vercel/GitHub-Actions
 * cron path, for anyone who'd rather run their own always-on process (a
 * VPS, Fly.io, Railway, a Raspberry Pi) instead of depending on an
 * external scheduler. This is REAL, working code using the exact same
 * functions `app/api/cron/scan/route.js` uses — not pseudo-code — so
 * fixes to the scanning/alerting logic apply to both call sites.
 *
 * What it does NOT do: anything with Supabase multi-user mode or Web
 * Push (both are tied to the HTTP request/response cycle of the Next.js
 * API route). This script covers the single-tenant path only: one
 * watchlist, Telegram and/or a webhook. For everything else, run the
 * actual Next.js app and point a scheduler at /api/cron/scan instead
 * (see README "Alerts that work with the browser closed").
 *
 * Usage:
 *   WATCH_SYMBOLS=BTCUSDT,ETHUSDT \
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
 *   MIN_SCORE=80 INTERVAL_MINUTES=5 \
 *   node examples/watcher.mjs
 *
 * Needs Node 22.3+ (same requirement as the rest of this project) only
 * because the codebase targets that version uniformly — this script
 * itself doesn't use mock.module or anything 22-specific.
 */

import { historicalDataEngine } from '../lib/binance/historical.js';
import { cloneDefaultConfig } from '../lib/config/strategyConfig.js';
import { scanWatchlist, toTrackerRecordShape } from '../lib/cron/alertScan.js';
import { sendTelegramMessage, sendWebhook, formatEvent } from '../lib/notifications/notify.js';

const WATCH_SYMBOLS = (process.env.WATCH_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT').split(',').map((s) => s.trim()).filter(Boolean);
const MIN_SCORE = Number(process.env.MIN_SCORE || 80);
const INTERVAL_MINUTES = Number(process.env.INTERVAL_MINUTES || 5);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

if (!TELEGRAM_BOT_TOKEN && !WEBHOOK_URL) {
  console.warn('[watcher] No TELEGRAM_BOT_TOKEN or WEBHOOK_URL set — the scan will run but nothing will be sent anywhere.');
}

const config = { ...cloneDefaultConfig(), alerts: { enabled: true, minScoreForAlert: MIN_SCORE, requireConfirmedState: true } };
const alreadyNotified = new Set(); // in-memory only — resets on restart, unlike the Supabase-backed cron path

async function loadCandles({ symbol, interval, count }) {
  return historicalDataEngine.load({ symbol, interval, count });
}

async function tick() {
  const startedAt = new Date().toISOString();
  console.log(`[watcher] ${startedAt} scanning ${WATCH_SYMBOLS.length} symbol(s)…`);

  const { qualifying, evaluated } = await scanWatchlist({
    config,
    watchlist: WATCH_SYMBOLS,
    loadCandles,
    maxSymbols: WATCH_SYMBOLS.length,
  });

  for (const e of evaluated) {
    console.log(`  ${e.symbol}: ${e.error ? `ERROR ${e.error}` : `${e.state} (score ${e.score})`}`);
  }

  for (const q of qualifying) {
    if (alreadyNotified.has(q.fingerprint)) continue;
    alreadyNotified.add(q.fingerprint);

    const ev = { type: q.signal.state.endsWith('CONFIRMED') ? 'CONFIRMED' : 'NEW', record: toTrackerRecordShape(q.signal) };
    const text = formatEvent(ev, 'en');
    console.log(`[watcher] ALERT ${q.symbol} score=${q.signal.score}`);

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      try {
        await sendTelegramMessage({ botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID, text });
      } catch (err) {
        console.error('[watcher] Telegram send failed:', err.message);
      }
    }
    if (WEBHOOK_URL) {
      try {
        await sendWebhook(WEBHOOK_URL, { type: ev.type, signal: q.signal });
      } catch (err) {
        console.error('[watcher] Webhook send failed:', err.message);
      }
    }
  }

  // Bound memory: an unbounded Set would grow forever on a long-lived process.
  if (alreadyNotified.size > 5000) alreadyNotified.clear();
}

console.log(`[watcher] starting — symbols=${WATCH_SYMBOLS.join(',')} minScore=${MIN_SCORE} every ${INTERVAL_MINUTES}min`);
tick().catch((err) => console.error('[watcher] tick failed:', err));
setInterval(() => tick().catch((err) => console.error('[watcher] tick failed:', err)), INTERVAL_MINUTES * 60_000);
