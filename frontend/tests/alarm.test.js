import test from 'node:test';
import assert from 'node:assert/strict';
import { Alarm } from '../src/alarm.js';
import { getSound } from '../src/entities.js';

class FakeContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.started = 0; this.stopped = 0; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  createGain() {
    const gain = { value: 0, setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; },
      exponentialRampToValueAtTime(value) { this.value = value; }, cancelScheduledValues() {} };
    return { gain, connect: target => target, disconnect() {} };
  }
  createOscillator() {
    return { frequency: {}, connect: target => target, disconnect() {}, start: () => this.started++, stop: () => this.stopped++ };
  }
}
test('desbloqueo silencioso, alarma y detención inmediata con contexto reutilizable', async () => {
  const alarm = new Alarm(FakeContext);
  await alarm.unlock();
  const context = alarm.context;
  assert.equal(context.started, 0);
  await alarm.prepare(getSound('synth-arpeggio'));
  alarm.start({ soundId: 'synth-arpeggio', volume: 0.5, escalation: false, vibration: false });
  assert.equal(context.started, 1);
  assert.equal(alarm.master.gain.value, 0.15);
  alarm.stop();
  assert.equal(alarm.timer, null);
  assert.equal(alarm.nodes.size, 0);
  assert.equal(alarm.master.gain.value, 0);
  assert.equal(alarm.context, context);
  await alarm.close();
  assert.equal(context.state, 'closed');
});
test('audio suspendido requiere un gesto de usuario', async () => {
  const alarm = new Alarm(FakeContext);
  await alarm.unlock();
  alarm.context.state = 'suspended';
  assert.throws(() => alarm.start({ soundId: 'synth-arpeggio' }), /suspendido/);
  await alarm.close();
});
