import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, STORAGE_KEY } from '../src/storage.js';
import { AlarmSounds, createSession, createEvent, createScheduledAlarm, validateScheduledAlarm, validateAlarmSound } from '../src/entities.js';

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}
test('el UUID y los ajustes permanecen entre recargas', () => {
  const adapter = memory();
  const first = createStorage(adapter);
  first.updateSettings({ volume: 0.75 });
  const next = createStorage(adapter).getState();
  assert.equal(next.device.id, first.getState().device.id);
  assert.equal(next.settings.deviceId, next.device.id);
  assert.equal(next.settings.volume, 0.75);
});
test('rechaza valores inválidos y recupera JSON dañado', () => {
  const adapter = memory();
  adapter.setItem(STORAGE_KEY, '{');
  const store = createStorage(adapter);
  assert.throws(() => store.updateSettings({ eyesClosedMs: -1 }));
  assert.throws(() => store.updateSettings({ volume: 2 }));
  assert.throws(() => store.updateSettings({ headNodAngle: 0 }));
  assert.equal(store.getState().settings.eyesClosedMs, 1500);
});
test('cuota agotada conserva alertas en memoria sin detener la vigilancia', () => {
  const store = createStorage({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } });
  const session = createSession(store.getState().device.id);
  store.addSession(session);
  store.addEvent(createEvent(session.id, 'EYES_CLOSED', 0.1, 1600, 'synth-arpeggio'));
  store.dismissEvents(session.id, 'auto_awake');
  assert.equal(store.persistent, false);
  assert.equal(store.getState().sessions[0].totalAlerts, 1);
  assert.equal(store.getState().events[0].dismissedBy, 'auto_awake');
});
test('recarga termina sesiones abandonadas y rechaza eventos sin sesión', () => {
  const adapter = memory();
  const store = createStorage(adapter);
  const session = createSession(store.getState().device.id);
  store.addSession(session);
  assert.equal(createStorage(adapter).getState().sessions[0].status, 'terminada');
  assert.throws(() => store.addEvent(createEvent(crypto.randomUUID(), 'HEAD_NOD', 20, 900, 'synth-arpeggio')));
});
test('sonidos válidos y alarma horaria preparada pero desactivada', () => {
  assert.ok(AlarmSounds.every(validateAlarmSound));
  const alarm = createScheduledAlarm(crypto.randomUUID());
  assert.ok(validateScheduledAlarm(alarm));
  assert.equal(alarm.enabled, false);
  assert.equal(validateScheduledAlarm({ ...alarm, time: '25:80' }), false);
});
