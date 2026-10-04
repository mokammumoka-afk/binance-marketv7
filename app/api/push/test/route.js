import { NextResponse } from 'next/server';
import { getRlsScopedClient } from '../../../../lib/supabase/serverClient';
import { sendWebPushToMany, webPushEnabled } from '../../../../lib/notifications/webPush';

/** Sends one test push to every subscription the CALLING user owns (RLS-scoped — never another user's device). */
export async function POST(request) {
  if (!webPushEnabled()) return NextResponse.json({ error: 'VAPID keys not configured on the server' }, { status: 400 });
  const sb = getRlsScopedClient(request);
  if (!sb) return NextResponse.json({ error: 'Supabase not configured or missing auth token' }, { status: 400 });

  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { data: subs, error } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userData.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subs?.length) return NextResponse.json({ error: 'No push subscription found for this device yet' }, { status: 404 });

  const results = await sendWebPushToMany(
    subs.map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })),
    { title: 'Market Intelligence — test', body: 'Push notifications are working.', url: '/' }
  );
  return NextResponse.json({ ok: true, results });
}
