'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '../lib/i18n';

const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9h13v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  market: (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V9M10 19V5M16 19v-7M21 19H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  analyzer: (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 15l4-5 3 3 5-7 4 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 20h18" strokeLinecap="round" />
    </svg>
  ),
  signals: (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.5 12a4.5 4.5 0 0 1 9 0M4.5 12a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const ITEMS = [
  { href: '/', key: 'nav.home', icon: 'home' },
  { href: '/market', key: 'nav.market', icon: 'market' },
  { href: '/analyzer', key: 'nav.analyzer', icon: 'analyzer' },
  { href: '/signals', key: 'nav.signals', icon: 'signals' },
  { href: '/more', key: 'nav.more', icon: 'more' },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { t } = useT();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[560px] justify-around border-t border-base-700 bg-base-900/95 backdrop-blur md:static md:max-w-none"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)' }}
    >
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
              active ? 'text-accent' : 'text-base-400'
            }`}
          >
            {ICONS[item.icon]}
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
