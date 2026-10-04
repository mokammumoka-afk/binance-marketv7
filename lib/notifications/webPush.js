/**
 * Web Push — SERVER-ONLY. Sends a real OS/browser push notification to a
 * subscribed device via the standard Push API protocol (RFC 8030 + VAPID),
 * using the well-established `web-push` npm package. This is what makes a
 * notification appear even when no tab is open: the browser's own push
 * service (Chrome/FCM, Firefox/Mozilla push, Safari/APNs on iOS 16.4+ for
 * an installed PWA) wakes the service worker to show it — not something
 * this app's own code keeps running.
 *
 * NOT testable in the sandbox that built this project (no network access
 * to a real push endpoint) — this follows the documented `web-push` API
 * exactly, but please send yourself one test notification after deploying
 * (Settings → enable push) before relying on it.
 */
import webpush from 'web-push';

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export const webPushEnabled = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/**
 * @param subscription { endpoint, keys: { p256dh, auth } } — exactly what
 *   PushSubscription.toJSON() produces in the browser.
 * @param payload plain object — stringified and encrypted for the client's
 *   service worker (see public/sw.js for how it's displayed).
 */
export async function sendWebPush(subscription, payload) {
  if (!ensureConfigured()) return { skipped: true, reason: 'VAPID keys not configured' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    // 404/410 means the subscription is gone (user revoked permission,
    // uninstalled, etc.) — the caller should delete it, not retry forever.
    const expired = err.statusCode === 404 || err.statusCode === 410;
    return { ok: false, expired, error: err.message, statusCode: err.statusCode };
  }
}

export async function sendWebPushToMany(subscriptions, payload) {
  const results = await Promise.all(subscriptions.map((s) => sendWebPush(s, payload)));
  return results;
}
