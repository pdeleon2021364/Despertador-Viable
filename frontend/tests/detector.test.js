import test from 'node:test';
import assert from 'node:assert/strict';
import { eyeAspectRatio, headPitch, createDetectionState, processMetrics, resetDetection, COOLDOWN_MS, AWAKE_MS } from '../src/detector.js';
import { summarizeCalibration } from '../src/calibration.js';

const awake = { ear: 0.3, pitch: 0, mouthRatio: 0.1 };
const closed = { ...awake, ear: 0.08 };
function detector(settings = {}) {
  return createDetectionState({ sensitivity: 'media', eyesClosedMs: 1500, headNodAngle: 15, yawnDetection: false, ...settings },
    { baselineEyeRatio: 0.3, baselineHeadPitch: 0 });
}
function frames(state, metrics, from, to) {
  const events = [];
  let result;
  for (let time = from; time <= to; time += 100) {
    result = processMetrics(state, metrics, time);
    if (result.event) events.push(result.event);
  }
  return { events, result };
}
test('EAR usa distancias y corrige la proporción de la imagen', () => {
  const points = [[0,0],[1,1],[2,1],[4,0],[2,-1],[1,-1]].map(([x,y]) => ({ x,y }));
  assert.equal(eyeAspectRatio(points), 0.5);
  assert.equal(eyeAspectRatio(points.map(p => ({ ...p, y: p.y / 2 })), 2), 0.5);
  assert.equal(eyeAspectRatio(Array(6).fill({ x: 0, y: 0 })), null);
  assert.equal(eyeAspectRatio([{ x: NaN, y: 0 }]), null);
});
test('pitch mide la inclinación hacia abajo y no cambia por traslación', () => {
  const forehead = { x: 0.5, y: 0.2, z: 0 };
  const chin = { x: 0.5, y: 0.8, z: 0.6 * Math.tan(20 * Math.PI / 180) };
  assert.ok(Math.abs(headPitch(forehead, chin) - 20) < 1e-9);
  const moved = point => ({ x: point.x + 0.1, y: point.y + 0.1, z: point.z + 0.3 });
  assert.ok(Math.abs(headPitch(moved(forehead), moved(chin)) - 20) < 1e-9);
});
test('ignora parpadeos breves y alerta después del umbral', () => {
  const state = detector();
  frames(state, awake, 0, 400);
  assert.equal(frames(state, closed, 500, 700).events.length, 0);
  assert.equal(frames(state, awake, 800, 1800).events.length, 0);
  const { events } = frames(state, closed, 1900, 4100);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'EYES_CLOSED');
  assert.ok(events[0].durationMs >= 1500);
});
test('cada sensibilidad cambia el porcentaje del baseline', () => {
  const partial = { ...awake, ear: 0.24 };
  assert.equal(frames(detector({ sensitivity: 'baja' }), partial, 0, 2500).events.length, 0);
  assert.equal(frames(detector({ sensitivity: 'alta' }), partial, 0, 2500).events[0].type, 'EYES_CLOSED');
});
test('un cabeceo breve se ignora; uno sostenido alerta', () => {
  const state = detector();
  const nod = { ...awake, pitch: 20 };
  assert.equal(frames(state, nod, 0, 500).events.length, 0);
  assert.equal(frames(state, awake, 600, 1800).events.length, 0);
  const result = frames(state, nod, 1900, 3500);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, 'HEAD_NOD');
});
test('bostezo está desactivado por defecto y requiere apertura sostenida', () => {
  const yawn = { ...awake, mouthRatio: 0.8 };
  assert.equal(frames(detector(), yawn, 0, 2000).events.length, 0);
  const state = detector({ yawnDetection: true });
  assert.equal(frames(state, yawn, 0, 900).events.length, 0);
  assert.equal(frames(state, yawn, 1000, 1600).events[0].type, 'YAWN');
});
test('cooldown evita repetición y vuelve a permitir eventos después', () => {
  const state = detector();
  assert.equal(frames(state, closed, 0, 2000).events.length, 1);
  assert.equal(frames(state, closed, 2100, 9400).events.length, 0);
  assert.equal(frames(state, closed, 9500, 9600).events.length, 1);
  resetDetection(state, 10000, true);
  assert.equal(state.cooldownUntil, 10000 + COOLDOWN_MS);
});
test('perder el rostro muestra No te veo y reinicia tiempos', () => {
  const state = detector();
  frames(state, closed, 0, 1000);
  const lost = frames(state, null, 1100, 4000);
  assert.equal(lost.events.length, 0);
  assert.equal(lost.result.kind, 'no_face');
  assert.equal(frames(state, closed, 4100, 5400).events.length, 0);
  assert.equal(frames(state, closed, 5500, 5800).events.length, 1);
});
test('un salto entre frames no cuenta como ojos cerrados', () => {
  const state = detector();
  frames(state, closed, 0, 1000);
  assert.equal(processMetrics(state, closed, 5000).event, undefined);
});
test('recuperación requiere ojos abiertos continuos y se reinicia si falta el rostro', () => {
  const state = detector();
  frames(state, closed, 0, 2000);
  assert.ok(frames(state, awake, 2100, 5700).result.awakeFor >= AWAKE_MS);
  assert.equal(processMetrics(state, null, 5800).awakeFor, 0);
  assert.equal(processMetrics(state, awake, 5900).awakeFor, 0);
});
test('calibración usa medianas y rechaza falta de muestras y movimientos', () => {
  assert.deepEqual(summarizeCalibration(Array(70).fill(awake)), { baselineEyeRatio: 0.3, baselineHeadPitch: 0 });
  assert.throws(() => summarizeCalibration([awake]), /muestras/);
  assert.throws(() => summarizeCalibration(Array(23).fill(awake)), /muestras/);
  assert.doesNotThrow(() => summarizeCalibration(Array(24).fill(awake)));
  assert.throws(() => summarizeCalibration([...Array(35).fill(awake), ...Array(35).fill({ ...awake, pitch: 20 })]), /movió/);
});
