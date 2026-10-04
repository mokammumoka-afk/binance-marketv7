/**
 * SERVER-ONLY Supabase clients. Two deliberately different trust levels:
 *
 *  - getRlsScopedClient(request): for routes acting on behalf of the
 *    browser that called them (e.g. saving a push subscription). Builds a
 *    client authenticated as THAT user's JWT (from the Authorization
 *    header the client sent), so Postgres Row Level Security enforces
 *    auth.uid() exactly as it would for a direct client-side call — this
 *    route can only ever touch that one user's rows, the same as if the
 *    browser had called Supabase directly.
 *
 *  - getServiceRoleClient(): for the cron job only. Uses
 *    SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely — required
 *    because the cron job runs with no browser/user attached and has to
 *    read every opted-in user's watchlist/config/subscriptions to deliver
 *    their alerts. This key must NEVER be sent to the browser (hence no
 *    NEXT_PUBLIC_ prefix) and must never be used for a route that acts on
 *    a single caller's request.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseServerConfigured = Boolean(url && anonKey);
export const serviceRoleConfigured = Boolean(url && serviceRoleKey);

export function getRlsScopedClient(request) {
  if (!supabaseServerConfigured) return null;
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let serviceClient = null;
export function getServiceRoleClient() {
  if (!serviceRoleConfigured) return null;
  if (!serviceClient) {
    serviceClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return serviceClient;
}
