'use client';

import { useEffect, useState } from 'react';
import { supabaseEnabled, getSupabase, ensureUser } from '../supabase/client';

/**
 * Reports whether Supabase is configured, and if so, whether the
 * anonymous session + a real query against the `signals` table actually
 * succeed — so a misconfigured schema or disabled Anonymous Sign-Ins
 * shows up here instead of silently failing inside random pages.
 */
export function useSupabaseStatus() {
  const [status, setStatus] = useState({
    enabled: supabaseEnabled,
    state: supabaseEnabled ? 'CONNECTING' : 'NOT_CONFIGURED',
    userId: null,
    error: null,
  });

  useEffect(() => {
    if (!supabaseEnabled) return;
    let cancelled = false;
    async function check() {
      try {
        const userId = await ensureUser();
        const sb = getSupabase();
        const { error } = await sb.from('signals').select('id', { count: 'exact', head: true }).limit(1);
        if (error) throw error;
        if (!cancelled) setStatus({ enabled: true, state: 'CONNECTED', userId, error: null });
      } catch (err) {
        if (!cancelled) setStatus({ enabled: true, state: 'ERROR', userId: null, error: err.message });
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
