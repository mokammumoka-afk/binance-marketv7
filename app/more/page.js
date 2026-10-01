'use client';

import Link from 'next/link';
import { useConfigStore } from '../../lib/runtime/configStore';
import { useT } from '../../lib/i18n';
import { isSupabaseActive } from '../../lib/storage/db';

const LINKS = [
  { href: '/backtest', key: 'nav.backtest', icon: '↻' },
  { href: '/paper-trading', key: 'nav.paper', icon: '◎' },
  { href: '/system', key: 'nav.system', icon: '⚙' },
  { href: '/settings', key: 'nav.settings', icon: '≡' },
];

export default function MorePage() {
  const { t, lang } = useT();
  const setLang = useConfigStore((s) => s.setLang);

  return (
    <div className="space-y-4 px-3 py-4">
      <div className="card divide-y divide-base-800">
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href} className="tap-row flex items-center justify-between px-4 py-3 text-sm active:bg-base-800">
            <span className="flex items-center gap-3">
              <span className="w-5 text-center text-base-400">{item.icon}</span>
              {t(item.key)}
            </span>
            <span className="text-base-500">›</span>
          </Link>
        ))}
      </div>

      <div className="card p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-base-500">{t('more.lang')}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setLang('ar')}
            className={`flex-1 rounded-lg border py-2 text-sm ${lang === 'ar' ? 'border-accent bg-accent-dim text-accent' : 'border-base-700 text-base-300'}`}
          >
            العربية
          </button>
          <button
            onClick={() => setLang('en')}
            className={`flex-1 rounded-lg border py-2 text-sm ${lang === 'en' ? 'border-accent bg-accent-dim text-accent' : 'border-base-700 text-base-300'}`}
          >
            English
          </button>
        </div>
      </div>

      <p className="px-1 text-center text-[11px] leading-relaxed text-base-500">{t('more.about')}</p>
      <p className="px-1 text-center text-[10px] text-base-600">SOURCE: BINANCE · SPOT · PUBLIC MARKET DATA</p>
      <p className="px-1 text-center text-[10px] text-base-600">
        STORAGE: {isSupabaseActive ? 'SUPABASE (SYNCED)' : 'LOCAL (THIS BROWSER)'} —{' '}
        <Link href="/system" className="underline">
          {t('nav.system')}
        </Link>
      </p>
    </div>
  );
}
