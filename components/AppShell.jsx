'use client';

import { useEffect } from 'react';
import { useConfigStore } from '../lib/runtime/configStore';
import { useT } from '../lib/i18n';
import StatusBar from './StatusBar';
import BottomNav from './BottomNav';
import { getTracker } from '../lib/runtime/tracker';

export default function AppShell({ children }) {
  const load = useConfigStore((s) => s.load);
  const loaded = useConfigStore((s) => s.loaded);
  const { dir, lang } = useT();

  useEffect(() => {
    load();
    getTracker(); // start hydrating the shared signal tracker as soon as the app opens
  }, [load]);

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [dir, lang]);

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[560px] flex-col overflow-hidden bg-base-950 md:max-w-none md:flex-row">
      <div className="flex flex-1 flex-col overflow-hidden">
        <StatusBar />
        <main className="flex-1 overflow-y-auto pb-16">
          {loaded ? children : <div className="p-6 text-center text-sm text-base-400">…</div>}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
