'use client';

/**
 * Client-side Web Push registration flow:
 *   1. register the service worker (public/sw.js)
 *   2. ask for Notification permission
 *   3. subscribe to the browser's push service with our VAPID public key
 *   4. send the subscription to our server (/api/push/subscribe), which
 *      stores it in Supabase so a later server-side event (the cron job)
 *      can push to this device with nobody looking at the app.
 *
 * Requires Supabase to be configured — without a server-side store for
 * the subscription, "notify me even with the browser closed" has nowhere
 * to read the subscription from later. If Supabase isn't configured this
 * returns a clear { ok:false, reason: 'SUPABASE_REQUIRED' } instead of
 * silently pretending to work.
 */
import { isSupabaseActive } from '../storage/db';
import { getAccessToken } from '../supabase/client';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushSubscriptionStatus() {
  if (!pushSupported()) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, permission: Notification.permission, subscribed: !!sub };
}

export async function enablePushNotifications() {
  if (!pushSupported()) return { ok: false, reason: 'UNSUPPORTED' };
  if (!isSupabaseActive) return { ok: false, reason: 'SUPABASE_REQUIRED' };
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { ok: false, reason: 'VAPID_NOT_CONFIGURED' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'PERMISSION_DENIED' };

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const token = await getAccessToken();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) return { ok: false, reason: 'SERVER_REJECTED', detail: await res.text() };
  return { ok: true };
}

export async function sendTestPush() {
  const token = await getAccessToken();
  const res = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: body.error || `HTTP ${res.status}` };
  return { ok: true, results: body.results };
}

export async function disablePushNotifications() {
  if (!pushSupported()) return { ok: false, reason: 'UNSUPPORTED' };
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try {
      const token = await getAccessToken();
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint }),
      });
    } catch {
      /* best-effort cleanup */
    }
  }
  return { ok: true };
}
