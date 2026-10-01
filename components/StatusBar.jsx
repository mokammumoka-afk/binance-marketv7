'use client';

import { useConnectionStatus } from '../lib/hooks/useConnectionStatus';
import { useT } from '../lib/i18n';

export default function StatusBar() {
  const { restStatus, wsStatus } = useConnectionStatus();
  const { t } = useT();

  const wsColor =
    wsStatus.status === 'CONNECTED' ? 'bg-long' : wsStatus.status === 'RECONNECTING' || wsStatus.status === 'CONNECTING' ? 'bg-warn' : 'bg-short';
  const restColor = restStatus.ok === true ? 'bg-long' : restStatus.ok === false ? 'bg-short' : 'bg-base-500';

  return (
    <header
      className="flex items-center justify-between border-b border-base-700 bg-base-900/90 px-3 backdrop-blur"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)', paddingBottom: 10 }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-base-100">{t('appName')}</span>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-base-400">
        <span className="flex items-center gap-1">
          <span className={`status-dot ${restColor}`} />
          REST{restStatus.latencyMs != null ? ` ${restStatus.latencyMs}ms` : ''}
        </span>
        <span className="flex items-center gap-1">
          <span className={`status-dot ${wsColor}`} />
          {t('live')}
        </span>
      </div>
    </header>
  );
}
