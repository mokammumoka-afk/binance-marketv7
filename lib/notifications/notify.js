/**
 * Notification dispatch. Everything is optional: the app works fully with no
 * Telegram / webhook / browser permission configured.
 */
import { getDisplayBadge } from '../signals/displayState';

const T = {
  NEW: ['New signal', 'إشارة جديدة'],
  CONFIRMED: ['Signal confirmed', 'إشارة مؤكدة'],
  TP1: ['TP1 reached', 'تحقق الهدف الأول'],
  TP2: ['TP2 reached', 'تحقق الهدف الثاني'],
  TP3: ['TP3 reached', 'تحقق الهدف الثالث'],
  SL: ['Stop loss hit', 'ضُرب وقف الخسارة'],
  INVALIDATED: ['Signal invalidated', 'أُلغيت الإشارة'],
  EXPIRED: ['Signal expired', 'انتهت صلاحية الإشارة'],
};

const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toPrecision(7).replace(/\.?0+$/, ''));

export function formatEvent(ev, lang = 'ar') {
  const r = ev.record;
  const i = lang === 'ar' ? 1 : 0;
  const dir = r.direction === 'LONG' ? (lang === 'ar' ? 'شراء (LONG)' : 'LONG') : lang === 'ar' ? 'بيع (SHORT)' : 'SHORT';
  const badge = getDisplayBadge(r);
  const lines = [
    `${badge.emoji} ${r.symbol} — ${lang === 'ar' ? badge.labelAr : badge.labelEn} (${T[ev.type]?.[i] || ev.type})`,
    `${dir} · ${r.timeframe} · Score ${r.score}/100 (${lang === 'ar' ? 'توافق، وليس احتمال ربح' : 'confluence, not a win probability'}) · ${r.strategyVersion}`,
    '',
    `${lang === 'ar' ? 'السعر الحالي' : 'Current Price'}: ${fmt(r.currentPriceAtSignal)}`,
    `${lang === 'ar' ? 'منطقة الدخول' : 'Entry Zone'}: ${fmt(r.entryZoneLow)} – ${fmt(r.entryZoneHigh)} (${r.entryType || 'Entry'}${r.entryPending ? `, ${lang === 'ar' ? 'لم يصل السعر بعد' : 'not reached yet'}` : ''})`,
    `VAH: ${fmt(r.vah)}  POC: ${fmt(r.poc)}  VAL: ${fmt(r.val)}`,
    `${lang === 'ar' ? 'وقف الخسارة' : 'Stop Loss'}: ${fmt(r.stopLoss)}`,
    `TP1: ${fmt(r.tp1)}  TP2: ${fmt(r.tp2)}  TP3: ${fmt(r.tp3)}`,
    `R:R: ${r.riskReward ? '1:' + r.riskReward.toFixed(2) : '—'}`,
  ];
  if (ev.type === 'NEW' || ev.type === 'CONFIRMED') {
    lines.push('', lang === 'ar' ? 'الأسباب:' : 'Reasons:', ...r.reasons.map((x) => `✓ ${x}`));
    if (r.warnings?.length) lines.push('', lang === 'ar' ? 'تحذيرات:' : 'Warnings:', ...r.warnings.map((x) => `⚠ ${x}`));
  }
  lines.push('', lang === 'ar' ? 'هذه الإشارات تحليلية وليست ضمانًا للربح ولا توصية مالية.' : 'Analytical signal only — not a profit guarantee, not financial advice.');
  return lines.join('\n');
}

export async function sendTelegramMessage({ botToken, chatId, text }) {
  if (!botToken || !chatId) return { skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function sendWebhook(url, payload) {
  if (!url) return { skipped: true };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
  return { ok: true };
}

export function browserNotify(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' });
}

export async function requestBrowserPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

/**
 * Does this event clear the user's alert bar? NEW/CONFIRMED are gated by
 * config.alerts.minScoreForAlert (and optionally requireConfirmedState) so
 * a flood of low-score WATCH-level noise never reaches Telegram/push/
 * browser notifications. Outcome events (TP/SL/EXPIRED/INVALIDATED) about
 * an already-alerted signal are never gated by score — the user who got
 * the entry alert should also hear how it played out.
 */
export function passesAlertGate(ev, config) {
  const alerts = config.alerts || {};
  if (alerts.enabled === false) return false;
  if (ev.type !== 'NEW' && ev.type !== 'CONFIRMED') return true;
  if (alerts.requireConfirmedState && ev.type !== 'CONFIRMED') return false;
  return (ev.record.score ?? 0) >= (alerts.minScoreForAlert ?? 0);
}

/** Fan a tracker event out to every enabled channel. Failures never throw. */
export async function dispatch(ev, config, lang = 'ar') {
  if (!passesAlertGate(ev, config)) return { skipped: 'below-alert-threshold' };
  const n = config.notifications || {};
  const text = formatEvent(ev, lang);
  const results = {};
  if (n.browserEnabled) {
    try {
      const badge = getDisplayBadge(ev.record);
      const title = `${badge.emoji} ${ev.record.symbol} — ${lang === 'ar' ? badge.labelAr : badge.labelEn}`;
      const body = `Score ${ev.record.score}/100 · Entry ${ev.record.entryZoneLow ?? ''}–${ev.record.entryZoneHigh ?? ''} · R:R ${ev.record.riskReward ? '1:' + ev.record.riskReward.toFixed(2) : '—'}`;
      browserNotify(title, body);
      results.browser = 'ok';
    } catch (e) {
      results.browser = String(e);
    }
  }
  if (n.telegramEnabled) {
    try {
      await sendTelegramMessage({ botToken: n.telegramBotToken, chatId: n.telegramChatId, text });
      results.telegram = 'ok';
    } catch (e) {
      results.telegram = String(e);
    }
  }
  if (n.webhookEnabled && n.webhookUrl) {
    try {
      await sendWebhook(n.webhookUrl, { type: ev.type, signal: ev.record, text });
      results.webhook = 'ok';
    } catch (e) {
      results.webhook = String(e);
    }
  }
  return results;
}
