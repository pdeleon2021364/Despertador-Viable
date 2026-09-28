const EYE_THRESHOLD = { baja: 0.65, media: 0.75, alta: 0.85 };
export const COOLDOWN_MS = 8000;
export const AWAKE_MS = 3000;
const validPoint = point => point && [point.x, point.y].every(Number.isFinite);
const distance = (a, b, aspect) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
export function eyeAspectRatio(points, aspect = 1) {
  if (points?.length !== 6 || !points.every(validPoint) || !(aspect > 0)) return null;
  const width = distance(points[0], points[3], aspect);
  return width > 0 ? (distance(points[1], points[5], aspect) + distance(points[2], points[4], aspect)) / (2 * width) : null;
}
export function headPitch(forehead, chin, aspect = 1) {
  if (!validPoint(forehead) || !validPoint(chin) || ![forehead.z, chin.z].every(Number.isFinite) || !(aspect > 0)) return null;
  const height = distance(forehead, chin, aspect);
  return height > 0 ? Math.atan2(chin.z - forehead.z, height) * 180 / Math.PI : null;
}
export function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
export function extractMetrics(landmarks, aspect = 1) {
  if (!landmarks || landmarks.length < 468) return null;
  const left = eyeAspectRatio([33, 160, 158, 133, 153, 144].map(i => landmarks[i]), aspect);
  const right = eyeAspectRatio([362, 385, 387, 263, 373, 380].map(i => landmarks[i]), aspect);
  const pitch = headPitch(landmarks[10], landmarks[152], aspect);
  const mouth = [61, 291, 13, 14].map(i => landmarks[i]);
  if (left === null || right === null || pitch === null || !mouth.every(validPoint)) return null;
  const width = distance(mouth[0], mouth[1], aspect);
  if (width === 0) return null;
  return { ear: (left + right) / 2, pitch, mouthRatio: distance(mouth[2], mouth[3], aspect) / width };
}
const NOISE = /blendshapesgraph|xnnpack|tensorflow lite|gl_context|gl version|opengl error checking|graph successfully started|graph finished closing|destroyed webgl|custom_dbg|put_char|mediapipe|vision_wasm|tflite|gl_context_webgl|setlog|registered op|created tensor/i;
let silenced = false;
export function silenceMediaPipeLogs() {
  if (silenced || typeof console === 'undefined') return;
  silenced = true;
  for (const level of ['log', 'info', 'warn', 'debug', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (args.some(arg => typeof arg === 'string' && NOISE.test(arg))) return;
      original(...args);
    };
  }
}
export async function loadLandmarker(signal) {
  silenceMediaPipeLogs();
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks('/vision');
  const url = import.meta.env.VITE_MODEL_URL || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  if (!response.ok) throw new Error('No se pudo descargar el modelo. Comprueba la conexión y vuelve a intentar.');
  const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
  for (const delegate of ['GPU', 'CPU']) {
    signal.throwIfAborted();
    try {
      const task = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer, delegate }, runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4, minTrackingConfidence: 0.4
      });
      if (signal.aborted) { task.close(); signal.throwIfAborted(); }
      return task;
    } catch (error) { if (delegate === 'CPU' || signal.aborted) throw error; }
  }
}
export function createDetectionState(settings, calibration) {
  return { settings, calibration, samples: [], closedSince: null, nodSince: null, yawnSince: null,
    awakeSince: null, missingSince: null, lastFrame: null, cooldownUntil: 0 };
}
export function resetDetection(state, now = 0, cooldown = false) {
  state.samples = [];
  state.closedSince = state.nodSince = state.yawnSince = state.awakeSince = state.missingSince = state.lastFrame = null;
  if (cooldown) state.cooldownUntil = now + COOLDOWN_MS;
}
export function processMetrics(state, metrics, now) {
  if (state.lastFrame !== null && now - state.lastFrame > 500) resetDetection(state);
  state.lastFrame = now;
  if (!metrics || ![metrics.ear, metrics.pitch, metrics.mouthRatio].every(Number.isFinite)) {
    state.samples = [];
    state.closedSince = state.nodSince = state.yawnSince = state.awakeSince = null;
    state.missingSince ??= now;
    return { kind: now - state.missingSince >= 2500 ? 'no_face' : 'searching', awakeFor: 0 };
  }
  state.missingSince = null;
  state.samples.push(metrics);
  if (state.samples.length > 5) state.samples.shift();
  const mean = key => average(state.samples.map(sample => sample[key]));
  const ear = mean('ear'), pitch = mean('pitch'), mouthRatio = mean('mouthRatio');
  const { settings, calibration } = state;
  const closed = ear < calibration.baselineEyeRatio * EYE_THRESHOLD[settings.sensitivity];
  const nod = pitch - calibration.baselineHeadPitch >= settings.headNodAngle;
  const yawn = settings.yawnDetection && mouthRatio > 0.6;
  for (const [key, condition] of [['closedSince', closed], ['nodSince', nod], ['yawnSince', yawn]]) {
    state[key] = condition ? state[key] ?? now : null;
  }
  const awake = ear >= calibration.baselineEyeRatio * 0.9
    && Math.abs(pitch - calibration.baselineHeadPitch) < settings.headNodAngle * 0.65 && mouthRatio < 0.45;
  state.awakeSince = awake ? state.awakeSince ?? now : null;
  const result = { kind: awake ? 'awake' : 'monitoring', metrics: { ear, pitch, mouthRatio }, awakeFor: awake ? now - state.awakeSince : 0 };
  if (now < state.cooldownUntil) return result;
  for (const [type, since, threshold, value] of [
    ['EYES_CLOSED', state.closedSince, settings.eyesClosedMs, ear],
    ['HEAD_NOD', state.nodSince, 700, pitch - calibration.baselineHeadPitch],
    ['YAWN', state.yawnSince, 1200, mouthRatio]
  ]) {
    if (since !== null && now - since >= threshold) {
      state.cooldownUntil = now + COOLDOWN_MS;
      return { ...result, kind: 'drowsy', event: { type, metricValue: value, durationMs: now - since } };
    }
  }
  return result;
}
