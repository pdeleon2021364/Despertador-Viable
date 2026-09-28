const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = value => typeof value === 'string' && value.length > 0;
const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const iso = () => new Date().toISOString();
function checked(value, validate, name) {
  if (!validate(value)) throw new TypeError(name + ' no válido');
  return value;
}

export const AlarmSounds = [
  { id: 'synth-arpeggio', name: 'Arpegio ascendente', type: 'synth', melodyDefinition: [523.25, 659.25, 783.99, 1046.5], durationSec: 2.4, intensity: 'fuerte', isDefault: true },
  { id: 'synth-chimes', name: 'Campanas suaves', type: 'synth', melodyDefinition: [440, 554.37, 659.25, 880], durationSec: 3.2, intensity: 'suave', isDefault: false },
  ...(import.meta.env?.VITE_LOCAL_SOUNDS || [])
];
export const getSound = id => AlarmSounds.find(sound => sound.id === id) || AlarmSounds[0];
export function validateDevice(d) {
  return Boolean(d && uuid(d.id) && date(d.createdAt) && text(d.locale));
}
export function validateSettings(s) {
  return Boolean(s && uuid(s.deviceId) && ['baja', 'media', 'alta'].includes(s.sensitivity)
    && between(s.eyesClosedMs, 500, 5000) && between(s.headNodAngle, 5, 45)
    && text(s.soundId) && between(s.volume, 0.1, 1)
    && ['escalation', 'vibration', 'yawnDetection'].every(key => typeof s[key] === 'boolean'));
}
export function validateCalibration(c) {
  return Boolean(c && uuid(c.deviceId) && between(c.baselineEyeRatio, 0.05, 1)
    && between(c.baselineHeadPitch, -90, 90) && date(c.createdAt));
}
export function validateAlarmSound(s) {
  return Boolean(s && text(s.id) && text(s.name) && between(s.durationSec, 0.1, 300)
    && ['suave', 'fuerte'].includes(s.intensity) && typeof s.isDefault === 'boolean'
    && ((s.type === 'synth' && Array.isArray(s.melodyDefinition) && s.melodyDefinition.length > 0
      && s.melodyDefinition.every(frequency => between(frequency, 40, 4000)))
      || (s.type === 'file' && /^\/sounds\/[^/]+\.(mp3|ogg|wav)$/i.test(s.filePath))));
}
export function validateSession(s) {
  return Boolean(s && uuid(s.id) && uuid(s.deviceId) && date(s.startedAt)
    && ['activa', 'pausada', 'terminada'].includes(s.status) && Number.isInteger(s.totalAlerts) && s.totalAlerts >= 0
    && (s.status === 'terminada' ? date(s.endedAt) && Date.parse(s.endedAt) >= Date.parse(s.startedAt) : s.endedAt === null));
}
export function validateEvent(e) {
  return Boolean(e && uuid(e.id) && uuid(e.sessionId) && date(e.detectedAt)
    && ['EYES_CLOSED', 'HEAD_NOD', 'YAWN'].includes(e.type) && Number.isFinite(e.metricValue)
    && Number.isFinite(e.durationMs) && e.durationMs >= 0 && text(e.soundId)
    && ((e.dismissedAt === null && e.dismissedBy === null)
      || (date(e.dismissedAt) && Date.parse(e.dismissedAt) >= Date.parse(e.detectedAt) && ['user_button', 'auto_awake'].includes(e.dismissedBy))));
}
export function validateScheduledAlarm(a) {
  return Boolean(a && uuid(a.id) && uuid(a.deviceId) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.time)
    && Array.isArray(a.daysOfWeek) && a.daysOfWeek.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && typeof a.enabled === 'boolean' && text(a.soundId));
}
export function createDevice() {
  return checked({ id: crypto.randomUUID(), createdAt: iso(), locale: globalThis.navigator?.language || 'es' }, validateDevice, 'Dispositivo');
}
export function createSettings(deviceId, value = {}) {
  return checked({ sensitivity: 'media', eyesClosedMs: 1500, headNodAngle: 15, soundId: AlarmSounds[0].id,
    volume: 0.6, escalation: true, vibration: false, yawnDetection: false, ...value, deviceId }, validateSettings, 'Ajustes');
}
export function createCalibration(deviceId, baselineEyeRatio, baselineHeadPitch) {
  return checked({ deviceId, baselineEyeRatio, baselineHeadPitch, createdAt: iso() }, validateCalibration, 'Calibración');
}
export function createSession(deviceId) {
  return checked({ id: crypto.randomUUID(), deviceId, startedAt: iso(), endedAt: null, status: 'activa', totalAlerts: 0 }, validateSession, 'Sesión');
}
export function createEvent(sessionId, type, metricValue, durationMs, soundId) {
  return checked({ id: crypto.randomUUID(), sessionId, detectedAt: iso(), type, metricValue, durationMs, soundId,
    dismissedAt: null, dismissedBy: null }, validateEvent, 'Evento');
}
export function createScheduledAlarm(deviceId) {
  return checked({ id: crypto.randomUUID(), deviceId, time: '07:00', daysOfWeek: [], enabled: false, soundId: AlarmSounds[0].id }, validateScheduledAlarm, 'Alarma programada');
}
