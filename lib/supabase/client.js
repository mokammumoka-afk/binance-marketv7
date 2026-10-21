'use client';

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True as soon as the two env vars are present — does not mean a live connection has been verified yet. */
export const supabaseEnabled = Boolean(url && key);

let client = null;
export function getSupabase() {
  if (!supabaseEnabled) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

let sessionPromise = null;
/**
 * Ensures an authenticated Supabase session and returns its user id.
 * Uses Supabase's ANONYMOUS auth (no email/password) so Row Level
 * Security policies scoped to `auth.uid()` work without building a login
 * screen. The anonymous identity is a refresh token stored in this
 * browser's localStorage — see README "Supabase setup" for what this
 * does and does not give you (important: it is per-browser, not an
 * account you can log into from another device, until you add real
 * email/password or magic-link auth on top of the same anonymous user).
 */
export function ensureUser() {
  const sb = getSupabase();
  if (!sb) return Promise.resolve(null);
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.user) return session.user.id;
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) {
        sessionPromise = null; // allow retry on the next call instead of caching a failure forever
        throw new Error(
          `Supabase anonymous sign-in failed: ${error.message}. In your Supabase project, enable ` +
          `Authentication → Providers → Anonymous Sign-Ins, then reload.`
        );
      }
      return data.user.id;
    })();
  }
  return sessionPromise;
}

/** Clears the cached session promise (e.g. after sign-out) so the next call re-authenticates. */
export function resetSession() {
  sessionPromise = null;
}

/**
 * Returns the current session's JWT access token, ensuring a session
 * exists first. API routes that need to act "as this user" (e.g.
 * /api/push/subscribe) pass this in an Authorization header instead of a
 * raw user id, so the server can create an RLS-scoped Supabase client
 * rather than trusting a client-supplied id at face value.
 */
export async function getAccessToken() {
  const sb = getSupabase();
  if (!sb) return null;
  await ensureUser();
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || null;
}
