/**
 * Notification dispatch. Everything is optional: the app works fully with no
 * Telegram / webhook / browser permission configured.
 */
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
  const lines = [
    `${r.direction === 'LONG' ? '🟢' : '🔴'} ${r.symbol} — ${T[ev.type]?.[i] || ev.type}`,
    `${dir} · ${r.timeframe} · Score ${r.score}/100 · ${r.strategyVersion}`,
    '',
    `Entry: ${fmt(r.entry)}`,
    `Stop Loss: ${fmt(r.stopLoss)}`,
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

/** Fan a tracker event out to every enabled channel. Failures never throw. */
export async function dispatch(ev, config, lang = 'ar') {
  const n = config.notifications || {};
  const text = formatEvent(ev, lang);
  const results = {};
  if (n.browserEnabled) {
    try {
      browserNotify(`${ev.record.symbol} ${T[ev.type]?.[lang === 'ar' ? 1 : 0] || ev.type}`, text.split('\n').slice(1, 3).join(' · '));
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
