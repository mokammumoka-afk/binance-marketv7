import { NextResponse } from 'next/server';
import { getRlsScopedClient } from '../../../../lib/supabase/serverClient';

export async function POST(request) {
  const sb = getRlsScopedClient(request);
  if (!sb) return NextResponse.json({ error: 'Supabase not configured or missing auth token' }, { status: 400 });

  const { subscription } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription payload' }, { status: 400 });
  }

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { error } = await sb.from('push_subscriptions').upsert(
    {
      user_id: userData.user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const sb = getRlsScopedClient(request);
  if (!sb) return NextResponse.json({ error: 'Supabase not configured or missing auth token' }, { status: 400 });

  const { endpoint } = await request.json();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { error } = await sb.from('push_subscriptions').delete().eq('user_id', userData.user.id).eq('endpoint', endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
