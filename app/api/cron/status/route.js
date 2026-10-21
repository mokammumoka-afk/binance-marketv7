import { NextResponse } from 'next/server';
import { serviceRoleConfigured } from '../../../../lib/supabase/serverClient';
import { webPushEnabled } from '../../../../lib/notifications/webPush';

/**
 * Configuration diagnostics only — reports whether each piece of the
 * background-alert pipeline is wired up, never the secret values
 * themselves. Safe to call from the browser with no auth: booleans only.
 */
export async function GET() {
  return NextResponse.json({
    cronSecretConfigured: !!process.env.CRON_SECRET,
    envFallbackConfigured: !!(process.env.CRON_SYMBOLS || '').trim(),
    envFallbackSymbolCount: (process.env.CRON_SYMBOLS || '').split(',').map((s) => s.trim()).filter(Boolean).length,
    envTelegramConfigured: !!(process.env.CRON_TELEGRAM_BOT_TOKEN && process.env.CRON_TELEGRAM_CHAT_ID),
    supabaseMultiUserConfigured: serviceRoleConfigured,
    webPushConfigured: webPushEnabled(),
    runningOnVercel: !!process.env.VERCEL,
  });
}
