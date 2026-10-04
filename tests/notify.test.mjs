import test from 'node:test';
import assert from 'node:assert/strict';
import { passesAlertGate } from '../lib/notifications/notify.js';

function cfg(overrides = {}) {
  return { alerts: { enabled: true, minScoreForAlert: 80, requireConfirmedState: true, ...overrides } };
}

test('passesAlertGate: NEW/CONFIRMED below the score threshold never pass', () => {
  assert.equal(passesAlertGate({ type: 'CONFIRMED', record: { score: 79 } }, cfg()), false);
  assert.equal(passesAlertGate({ type: 'CONFIRMED', record: { score: 80 } }, cfg()), true);
});

test('passesAlertGate: requireConfirmedState blocks a high-score CANDIDATE', () => {
  assert.equal(passesAlertGate({ type: 'NEW', record: { score: 95 } }, cfg({ requireConfirmedState: true })), false);
  assert.equal(passesAlertGate({ type: 'NEW', record: { score: 95 } }, cfg({ requireConfirmedState: false })), true);
});

test('passesAlertGate: outcome events (TP/SL/EXPIRED) are never score-gated', () => {
  assert.equal(passesAlertGate({ type: 'SL', record: { score: 10 } }, cfg({ minScoreForAlert: 90 })), true);
  assert.equal(passesAlertGate({ type: 'TP1', record: { score: 5 } }, cfg()), true);
});

test('passesAlertGate: alerts.enabled=false blocks everything, including outcomes', () => {
  assert.equal(passesAlertGate({ type: 'SL', record: { score: 99 } }, cfg({ enabled: false })), false);
});
