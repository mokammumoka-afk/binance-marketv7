'use client';
import { create } from 'zustand';
import { cloneDefaultConfig } from '../config/strategyConfig';
import { getSetting, setSetting } from '../storage/db';

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
  return out;
}

/** Strategy config + UI language, persisted in IndexedDB. */
export const useConfigStore = create((set, get) => ({
  config: cloneDefaultConfig(),
  lang: 'ar',
  loaded: false,
  async load() {
    if (get().loaded) return;
    const saved = await getSetting('strategyConfig', null);
    const lang = await getSetting('lang', 'ar');
    set({ config: saved ? deepMerge(cloneDefaultConfig(), saved) : cloneDefaultConfig(), lang, loaded: true });
  },
  async save(config) {
    set({ config });
    await setSetting('strategyConfig', config);
  },
  async setLang(lang) {
    set({ lang });
    await setSetting('lang', lang);
  },
}));
