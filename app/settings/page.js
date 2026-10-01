'use client';

import { useState } from 'react';
import { useConfigStore } from '../../lib/runtime/configStore';
import { getWatchlist, setWatchlist as persistWatchlist } from '../../lib/storage/db';
import { SUPPORTED_INTERVALS } from '../../lib/data/candle';
import { STRATEGY_VARIANTS } from '../../lib/signals/signalEngine';
import { sendTelegramMessage } from '../../lib/notifications/notify';
import { useEffect } from 'react';
import { useT } from '../../lib/i18n';

export default function SettingsPage() {
  const { t } = useT();
  const config = useConfigStore((s) => s.config);
  const save = useConfigStore((s) => s.save);
  const [local, setLocal] = useState(config);
  const [watchlistInput, setWatchlistInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [permStatus, setPermStatus] = useState(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');

  useEffect(() => setLocal(config), [config]);
  useEffect(() => {
    getWatchlist().then((wl) => setWatchlistInput(wl.join(', ')));
  }, []);

  function update(path, value) {
    setLocal((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      let obj = next;
      const parts = path.split('.');
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }

  async function onSave() {
    await save(local);
    const wl = watchlistInput.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    await persistWatchlist(wl);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function testTelegram() {
    setTelegramStatus('sending');
    try {
      await sendTelegramMessage({ botToken: local.notifications.telegramBotToken, chatId: local.notifications.telegramChatId, text: '✅ Test message — Market Intelligence Bot' });
      setTelegramStatus('ok');
    } catch (err) {
      setTelegramStatus('error: ' + err.message);
    }
  }

  async function askPermission() {
    if ('Notification' in window) {
      const p = await Notification.requestPermission();
      setPermStatus(p);
    }
  }

  return (
    <div className="space-y-4 px-3 py-4">
      <Section title="Strategy Variant">
        <select value={local.strategyVariant} onChange={(e) => update('strategyVariant', e.target.value)} className="select">
          {Object.entries(STRATEGY_VARIANTS).map(([k, v]) => (
            <option key={k} value={k}>{k} — {v.label}</option>
          ))}
        </select>
      </Section>

      <Section title="Timeframes">
        <div className="grid grid-cols-3 gap-2">
          <TfSelect label="HTF" value={local.timeframes.htf} onChange={(v) => update('timeframes.htf', v)} />
          <TfSelect label="MTF" value={local.timeframes.mtf} onChange={(v) => update('timeframes.mtf', v)} />
          <TfSelect label="LTF" value={local.timeframes.ltf} onChange={(v) => update('timeframes.ltf', v)} />
        </div>
      </Section>

      <Section title="Signal Requirements">
        <Num label="Minimum Score" value={local.minScore} onChange={(v) => update('minScore', v)} />
        <Num label="Minimum R:R" value={local.minRR} onChange={(v) => update('minRR', v)} step={0.1} />
        <Num label="ATR Multiplier (SL)" value={local.atrMultiplier} onChange={(v) => update('atrMultiplier', v)} step={0.1} />
        <Check label="Require HTF Alignment" checked={local.requireHTFAlignment} onChange={(v) => update('requireHTFAlignment', v)} />
        <Check label="Require Volume Confirmation" checked={local.requireVolumeConfirmation} onChange={(v) => update('requireVolumeConfirmation', v)} />
        <Check label="Require POC Interaction" checked={local.requirePOCInteraction} onChange={(v) => update('requirePOCInteraction', v)} />
        <Check label="Early Mode (may repaint)" checked={local.earlyMode} onChange={(v) => update('earlyMode', v)} />
      </Section>

      <Section title="Entry / Stop Method">
        <label className="block text-sm">
          <div className="mb-1 text-[11px] text-base-400">Entry Mode</div>
          <select value={local.entryMode} onChange={(e) => update('entryMode', e.target.value)} className="select">
            {['CLOSE', 'POC_RETEST', 'BREAKOUT', 'SWING_CONFIRM'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <div className="mb-1 text-[11px] text-base-400">Stop Method</div>
          <select value={local.stopMethod} onChange={(e) => update('stopMethod', e.target.value)} className="select">
            {['STRUCTURE', 'ATR', 'STRUCTURE_ATR'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </Section>

      <Section title="No-Trade Gates">
        <Num label="Max ATR % (extreme volatility)" value={local.gates.maxAtrPct} onChange={(v) => update('gates.maxAtrPct', v)} step={0.1} />
        <Num label="Min ATR % (too quiet)" value={local.gates.minAtrPct} onChange={(v) => update('gates.minAtrPct', v)} step={0.01} />
        <Num label="Min Relative Volume" value={local.gates.minRelVolume} onChange={(v) => update('gates.minRelVolume', v)} step={0.05} />
        <Num label="Max Spread %" value={local.gates.maxSpreadPct} onChange={(v) => update('gates.maxSpreadPct', v)} step={0.01} />
      </Section>

      <Section title="Risk Management">
        <Num label="Account Size (USDT)" value={local.accountSize} onChange={(v) => update('accountSize', v)} />
        <Num label="Risk % per Trade" value={local.riskPercent} onChange={(v) => update('riskPercent', v)} step={0.1} />
      </Section>

      <Section title="Watchlist">
        <textarea value={watchlistInput} onChange={(e) => setWatchlistInput(e.target.value)} className="mono-num h-20 w-full rounded-lg border border-base-600 bg-base-800 px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="BTCUSDT, ETHUSDT" />
      </Section>

      <Section title="Notifications">
        <Check label="Browser Notifications" checked={local.notifications.browserEnabled} onChange={(v) => update('notifications.browserEnabled', v)} />
        <button onClick={askPermission} className="rounded-lg border border-base-600 px-3 py-1.5 text-xs text-base-300">
          Permission: {permStatus}
        </button>
        <Check label="Telegram" checked={local.notifications.telegramEnabled} onChange={(v) => update('notifications.telegramEnabled', v)} />
        <Text label="Bot Token" value={local.notifications.telegramBotToken} onChange={(v) => update('notifications.telegramBotToken', v)} />
        <Text label="Chat ID" value={local.notifications.telegramChatId} onChange={(v) => update('notifications.telegramChatId', v)} />
        <button onClick={testTelegram} className="rounded-lg bg-accent-dim px-3 py-1.5 text-xs text-accent">Send Test Message</button>
        {telegramStatus && <div className="text-xs text-base-400">{telegramStatus}</div>}
        <Check label="Webhook" checked={local.notifications.webhookEnabled} onChange={(v) => update('notifications.webhookEnabled', v)} />
        <Text label="Webhook URL" value={local.notifications.webhookUrl} onChange={(v) => update('notifications.webhookUrl', v)} />
      </Section>

      <button onClick={onSave} className="w-full rounded-lg bg-long-dim py-3 text-sm font-medium text-long-bright">
        {saved ? t('saved') : t('save')}
      </button>

      <style jsx global>{`
        .select { width: 100%; background: #161C29; border: 1px solid #2A3441; border-radius: 8px; padding: 6px 10px; font-size: 13px; color: #E4E9EE; }
      `}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card space-y-2.5 p-4">
      <div className="text-xs uppercase tracking-wide text-base-500">{title}</div>
      {children}
    </div>
  );
}
function TfSelect({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-base-400">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        {SUPPORTED_INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
      </select>
    </label>
  );
}
function Num({ label, value, onChange, step = 1 }) {
  return (
    <label className="flex items-center justify-between text-sm">
      <span className="text-base-300">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mono-num w-24 rounded-lg border border-base-600 bg-base-800 px-2 py-1 text-end focus:border-accent focus:outline-none" />
    </label>
  );
}
function Text({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-base-400">{label}</div>
      <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} className="mono-num w-full rounded-lg border border-base-600 bg-base-800 px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
    </label>
  );
}
function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-base-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
