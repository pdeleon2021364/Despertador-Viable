import { Alarm } from './alarm.js';
import { calibrate } from './calibration.js';
import { AlarmSounds, createCalibration, createEvent, createSession, getSound } from './entities.js';
import { AWAKE_MS, createDetectionState, extractMetrics, loadLandmarker, processMetrics, resetDetection, silenceMediaPipeLogs } from './detector.js';
import { createStorage } from './storage.js';

const $ = id => document.getElementById(id);
const store = createStorage();
const alarm = new Alarm();
let phase = 'idle', session = null, stream = null, landmarker = null, detection = null;
let controller = null, wakeLock = null, frameId = 0, lastVideoTime = -1, lastFrameAt = 0;
let alarmActive = false, sessionTimer = null, toastTimer = null, previewTimer = null;

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500);
}
function showError(message = '') {
  $('error-message').textContent = message;
  $('error-message').hidden = !message;
}
function syncStorage() { $('storage-warning').hidden = store.persistent; }
function show(id) {
  for (const section of ['inicio', 'calibration', 'monitor', 'settings', 'history']) $(section).hidden = section !== id;
  $('home').disabled = phase !== 'idle';
  const heading = $(id).querySelector('h2');
  heading?.focus();
}
function stopPreview() {
  clearTimeout(previewTimer);
  if (!alarmActive) alarm.stop();
  $('preview-sound').textContent = 'Probar sonido';
}
function home() {
  if (phase !== 'idle') return;
  stopPreview();
  showError();
  show('inicio');
}
function renderSettings() {
  const s = store.getState().settings;
  $('sensitivity').value = s.sensitivity;
  $('eyes-closed').value = s.eyesClosedMs;
  $('head-angle').value = s.headNodAngle;
  $('sound').value = getSound(s.soundId).id;
  $('volume').value = s.volume;
  $('volume-value').textContent = Math.round(s.volume * 100) + '%';
  for (const key of ['escalation', 'vibration']) $(key).checked = s[key];
  $('yawn').checked = s.yawnDetection;
  $('vibration').disabled = !navigator.vibrate;
  $('vibration-info').hidden = Boolean(navigator.vibrate);
}
function settingsFromForm() {
  const eyesClosedMs = Number($('eyes-closed').value);
  const headNodAngle = Number($('head-angle').value);
  const volume = Number($('volume').value);
  if (!Number.isFinite(eyesClosedMs) || eyesClosedMs < 500 || eyesClosedMs > 5000) throw new Error('Tiempo de ojos cerrados inválido.');
  if (!Number.isFinite(headNodAngle) || headNodAngle < 5 || headNodAngle > 45) throw new Error('Ángulo de cabeceo inválido.');
  if (!Number.isFinite(volume) || volume < 0.1 || volume > 1) throw new Error('Volumen inválido.');
  return { sensitivity: $('sensitivity').value, eyesClosedMs,
    headNodAngle, soundId: $('sound').value, volume,
    escalation: $('escalation').checked, vibration: $('vibration').checked, yawnDetection: $('yawn').checked };
}
const eventNames = { EYES_CLOSED: 'Ojos cerrados', HEAD_NOD: 'Cabeceo', YAWN: 'Bostezo' };
function renderHistory() {
  const { sessions, events } = store.getState();
  const list = $('history-list');
  list.replaceChildren();
  if (!sessions.length) { list.textContent = 'Todavía no hay sesiones. Inicia la vigilancia para registrar tu primera sesión.'; return; }
  for (const item of sessions) {
    const details = document.createElement('details');
    details.className = 'history-item';
    const summary = document.createElement('summary');
    const minutes = Math.max(0, Math.round((Date.parse(item.endedAt || new Date().toISOString()) - Date.parse(item.startedAt)) / 60000));
    summary.textContent = new Date(item.startedAt).toLocaleString() + ' · ' + item.totalAlerts + ' alertas · ' + minutes + ' min · ' + item.status;
    details.append(summary);
    const rows = events.filter(event => event.sessionId === item.id);
    if (!rows.length) {
      const empty = document.createElement('p'); empty.textContent = 'Sin alertas registradas.'; details.append(empty);
    }
    for (const event of rows) {
      const row = document.createElement('p');
      const dismissal = event.dismissedBy === 'auto_awake' ? 'Recuperación detectada' : event.dismissedBy === 'user_button' ? 'Detenida por ti' : 'Sin respuesta registrada';
      row.textContent = new Date(event.detectedAt).toLocaleTimeString() + ' — ' + eventNames[event.type]
        + ' (' + (event.durationMs / 1000).toFixed(1) + ' s) · ' + getSound(event.soundId).name + ' · ' + dismissal
        + (event.dismissedAt ? ' a las ' + new Date(event.dismissedAt).toLocaleTimeString() : '');
      details.append(row);
    }
    list.append(details);
  }
}
async function acquireWakeLock() {
  if (!navigator.wakeLock) { $('wake-status').textContent = 'Mantén la pantalla encendida: este navegador no ofrece bloqueo de pantalla.'; return; }
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (phase !== 'active') { await lock.release(); return; }
    wakeLock = lock;
    $('wake-status').textContent = 'Pantalla activa mientras esta pestaña esté visible.';
    lock.addEventListener('release', () => {
      if (wakeLock === lock) { wakeLock = null; $('wake-status').textContent = 'El sistema liberó la pantalla. Mantén la pestaña visible.'; }
    });
  } catch { $('wake-status').textContent = 'No se pudo mantener la pantalla encendida. Revisa el ahorro de batería.'; }
}
function cameraError(error) {
  if (error.name === 'NotAllowedError') return 'Cámara bloqueada. Abre el icono de permisos junto a la dirección, permite la cámara y vuelve a intentar. En móviles necesitas HTTPS.';
  if (error.name === 'NotFoundError') return 'No encontramos una cámara. Conecta una y vuelve a intentar.';
  if (error.name === 'NotReadableError') return 'La cámara está ocupada. Cierra otras aplicaciones que la estén usando.';
  if (error.name === 'TimeoutError') return 'La descarga del detector tardó demasiado. Revisa tu conexión y vuelve a intentar.';
  return error.message || 'No se pudo iniciar la vigilancia.';
}
async function start() {
  if (phase !== 'idle') return;
  stopPreview(); showError();
  phase = 'starting';
  const run = new AbortController();
  controller = run;
  show('calibration');
  $('calibration-progress').value = 0;
  $('calibration-count').textContent = 'Permite el acceso a la cámara…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere HTTPS o localhost y un navegador actualizado.');
    await alarm.unlock();
    run.signal.throwIfAborted();
    const captured = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 30 } } });
    if (run.signal.aborted) { captured.getTracks().forEach(track => track.stop()); return; }
    stream = captured;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (phase !== 'idle') { void finish(); showError('La cámara se desconectó. Vuelve a iniciar la vigilancia.'); } });
    $('video').srcObject = stream;
    await $('video').play();
    $('calibration-count').textContent = 'Cargando el detector. La primera vez puede tardar unos segundos…';
    const task = await loadLandmarker(run.signal);
    if (run.signal.aborted) { task.close(); return; }
    landmarker = task;
    await alarm.prepare(getSound(store.getState().settings.soundId), run.signal);
    const baseline = await calibrate($('video'), landmarker, run.signal, (value, message) => {
      $('calibration-progress').value = value;
      $('calibration-count').textContent = message + ' ' + Math.floor(value * 100) + '%';
    });
    run.signal.throwIfAborted();
    const { device, settings } = store.getState();
    const calibration = createCalibration(device.id, baseline.baselineEyeRatio, baseline.baselineHeadPitch);
    store.saveCalibration(calibration);
    session = createSession(device.id);
    store.addSession(session);
    detection = createDetectionState(settings, calibration);
    $('monitor-video').srcObject = stream;
    await $('monitor-video').play();
    $('video').srcObject = null;
    phase = 'active';
    lastVideoTime = -1; lastFrameAt = 0;
    $('alert-count').textContent = '0';
    $('live-state').textContent = 'Buscando rostro…';
    $('monitor-message').textContent = 'Vigilancia activa. Mantén esta pestaña visible.';
    $('pause').hidden = false; $('resume').hidden = true;
    show('monitor'); syncStorage();
    sessionTimer = setInterval(() => {
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000));
      $('session-time').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }, 1000);
    $('session-time').textContent = '00:00';
    void acquireWakeLock();
    frameId = requestAnimationFrame(tick);
  } catch (error) {
    if (controller === run) {
      if (run.signal.aborted) { await finish(); }
      else { await finish(); showError(cameraError(error)); }
    }
  }
}
function trigger(event) {
  if (alarmActive || !session) return;
  alarmActive = true;
  const { settings } = store.getState();
  const next = store.addEvent(createEvent(session.id, event.type, event.metricValue, event.durationMs, settings.soundId));
  $('alert-count').textContent = String(next.sessions.find(s => s.id === session.id).totalAlerts);
  $('monitor-message').textContent = eventNames[event.type] + '. Reacciona o pulsa Estoy despierto.';
  $('awake').hidden = false;
  $('awake').focus();
  try { alarm.start(settings); }
  catch (error) { $('enable-audio').hidden = false; showError(error.message); }
  syncStorage();
}
function stopAlarm(by = 'user_button') {
  alarmActive = false;
  alarm.stop();
  if (session) store.dismissEvents(session.id, by);
  if (detection) resetDetection(detection, performance.now(), true);
  $('awake').hidden = $('enable-audio').hidden = true;
  $('monitor').classList.remove('monitor-alert');
  $('monitor-message').textContent = by === 'auto_awake' ? 'Detectamos que volviste a estar alerta.' : 'Alarma detenida. Considera hacer una pausa para descansar.';
}
function tick(now) {
  if (phase !== 'active') return;
  try {
    const video = $('monitor-video');
    let result;
    if (now - lastFrameAt >= 65 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      lastFrameAt = now;
      const face = landmarker.detectForVideo(video, now).faceLandmarks[0];
      result = processMetrics(detection, extractMetrics(face, video.videoHeight / video.videoWidth), now);
    } else if (now - lastFrameAt > 500) result = processMetrics(detection, null, now);
    if (result) {
      if (result.event) trigger(result.event);
      if (alarmActive && result.awakeFor >= AWAKE_MS) stopAlarm('auto_awake');
      const missing = ['no_face', 'searching'].includes(result.kind);
      $('face-status').textContent = missing ? (result.kind === 'no_face' ? 'No te veo' : 'Buscando rostro…') : 'Rostro detectado';
      $('live-state').textContent = alarmActive ? '¡Reacciona!' : missing ? $('face-status').textContent : result.kind === 'awake' ? 'Despierto' : 'Atención';
      $('monitor').classList.toggle('monitor-alert', alarmActive);
      if (!alarmActive) $('monitor-message').textContent = missing ? 'No te veo bien. Acerca tu rostro a la cámara.' : 'Vigilancia activa. Mantén esta pestaña visible.';
      const catImage = $('cat-image');
      const catLabel = $('cat-label');
      const catBox = $('cat-box');
      const isDrowsy = result.kind === 'drowsy' || alarmActive;
      const newSrc = isDrowsy ? '/GatoDurmiendo.png' : '/GatoDespierto.png';
      const newLabel = isDrowsy ? 'Durmiendo…' : 'Despierto';
      if (catImage.src !== new URL(newSrc, window.location.href).href) {
        catImage.src = newSrc;
        catImage.alt = isDrowsy ? 'Gato durmiendo' : 'Gato despierto';
        catLabel.textContent = newLabel;
        catBox.classList.toggle('drowsy', isDrowsy);
      }
    }
    frameId = requestAnimationFrame(tick);
  } catch (error) { void finish(); showError('La detección se detuvo: ' + error.message); }
}
function pause(manual = true) {
  if (phase !== 'active') return;
  phase = 'paused';
  cancelAnimationFrame(frameId);
  if (manual && alarmActive) stopAlarm();
  resetDetection(detection);
  stream.getVideoTracks().forEach(track => { track.enabled = false; });
  store.updateSession(session.id, { status: 'pausada' });
  void wakeLock?.release().catch(() => {});
  $('live-state').textContent = alarmActive ? '¡Reacciona!' : 'Vigilancia pausada';
  $('monitor-message').textContent = manual ? 'La cámara está en pausa. Reanuda cuando estés listo.' : 'La pestaña dejó de estar visible. Pulsa Reanudar para continuar.';
  $('pause').hidden = true; $('resume').hidden = false;
}
async function resume() {
  if (phase !== 'paused') return;
  try {
    await alarm.unlock();
    stream.getVideoTracks().forEach(track => { track.enabled = true; });
    await $('monitor-video').play();
    phase = 'active';
    store.updateSession(session.id, { status: 'activa' });
    resetDetection(detection);
    lastVideoTime = -1; lastFrameAt = 0;
    $('pause').hidden = false; $('resume').hidden = true;
    showError(); void acquireWakeLock();
    frameId = requestAnimationFrame(tick);
  } catch (error) { showError(error.message); }
}
async function finish() {
  controller?.abort(); controller = null;
  cancelAnimationFrame(frameId); clearInterval(sessionTimer); clearTimeout(previewTimer);
  if (alarmActive) stopAlarm();
  const closing = alarm.close();
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  landmarker?.close(); landmarker = null;
  $('video').srcObject = $('monitor-video').srcObject = null;
  void wakeLock?.release().catch(() => {}); wakeLock = null;
  if (session) store.updateSession(session.id, { status: 'terminada', endedAt: new Date().toISOString() });
  session = null; detection = null; phase = 'idle'; alarmActive = false;
  $('awake').hidden = $('enable-audio').hidden = true;
  $('monitor').classList.remove('monitor-alert');
  show('inicio'); syncStorage();
  await closing;
}

for (const sound of AlarmSounds) {
  const option = document.createElement('option'); option.value = sound.id; option.textContent = sound.name; $('sound').append(option);
}
$('start').addEventListener('click', () => void start());
$('cancel').addEventListener('click', () => void finish());
$('stop').addEventListener('click', () => void finish());
$('awake').addEventListener('click', () => stopAlarm());
$('pause').addEventListener('click', () => pause());
$('resume').addEventListener('click', () => void resume());
$('enable-audio').addEventListener('click', async () => {
  try { await alarm.unlock(); if (alarmActive) alarm.start(store.getState().settings); $('enable-audio').hidden = true; showError(); }
  catch (error) { showError(error.message); }
});
for (const id of ['home', 'settings-back', 'history-back']) $(id).addEventListener('click', home);
$('show-settings').addEventListener('click', () => { showError(); renderSettings(); show('settings'); });
$('show-history').addEventListener('click', () => { showError(); renderHistory(); show('history'); });
$('volume').addEventListener('input', () => { $('volume-value').textContent = Math.round(Number($('volume').value) * 100) + '%'; });
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try { store.updateSettings(settingsFromForm()); syncStorage(); home(); toast('Ajustes guardados.'); }
  catch (error) { showError(error.message); }
});
$('preview-sound').addEventListener('click', async () => {
  if (alarm.active) { stopPreview(); return; }
  const button = $('preview-sound');
  button.disabled = true;
  try {
    await alarm.unlock();
    const settings = settingsFromForm();
    await alarm.prepare(getSound(settings.soundId));
    if ($('settings').hidden) return;
    alarm.start(settings);
    button.textContent = 'Detener prueba';
    previewTimer = setTimeout(stopPreview, 3500);
  } catch (error) { showError(error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  stopPreview();
  if (phase === 'starting') { void finish(); showError('La calibración se canceló al ocultar la pestaña. Vuelve a iniciar.'); }
  else pause(false);
});
window.addEventListener('pagehide', () => { void finish(); });
silenceMediaPipeLogs();
syncStorage();
