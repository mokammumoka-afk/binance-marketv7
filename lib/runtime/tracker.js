import { SignalTracker } from '../signals/signalTracker';
import { saveSignalRecord, saveSignalEvent, loadSignalRecords } from '../storage/db';

let tracker = null;
let hydrating = null;

/** One shared tracker for the whole app so a setup is one signal everywhere. */
export function getTracker(cooldownMs) {
  if (!tracker) {
    tracker = new SignalTracker({
      cooldownMs,
      persist: { saveRecord: saveSignalRecord, saveEvent: saveSignalEvent },
    });
    hydrating = loadSignalRecords().then((r) => tracker.hydrate(r)).catch(() => {});
  }
  if (cooldownMs) tracker.cooldownMs = cooldownMs;
  return tracker;
}

export async function trackerReady() {
  getTracker();
  await hydrating;
  return tracker;
}
