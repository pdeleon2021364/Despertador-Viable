import { createDevice, createSettings, validateDevice, validateSettings, validateCalibration,
  validateSession, validateEvent, validateScheduledAlarm, getSound } from './entities.js';

export const STORAGE_KEY = 'anti-suenio:v1';
export function createStorage(adapter) {
  let persistent = true;
  try { adapter ??= globalThis.localStorage; if (!adapter) persistent = false; }
  catch { persistent = false; }
  let stored;
  try { stored = JSON.parse(adapter?.getItem(STORAGE_KEY) || 'null'); } catch { stored = null; }
  const device = validateDevice(stored?.device) ? stored.device : createDevice();
  const belongs = value => value?.deviceId === device.id;
  const settings = validateSettings(stored?.settings) && belongs(stored.settings) ? stored.settings : createSettings(device.id);
  settings.soundId = getSound(settings.soundId).id;
  const state = {
    device, settings,
    calibration: validateCalibration(stored?.calibration) && belongs(stored.calibration) ? stored.calibration : null,
    sessions: (Array.isArray(stored?.sessions) ? stored.sessions : []).filter(s => validateSession(s) && belongs(s)).slice(0, 100),
    events: (Array.isArray(stored?.events) ? stored.events : []).filter(validateEvent).slice(0, 1000),
    scheduledAlarms: (Array.isArray(stored?.scheduledAlarms) ? stored.scheduledAlarms : []).filter(a => validateScheduledAlarm(a) && belongs(a)).map(a => ({ ...a, enabled: false }))
  };
  // Una sesión abandonada por cierre o recarga no sigue vigilando.
  for (const session of state.sessions) {
    if (session.status !== 'terminada') Object.assign(session, { status: 'terminada', endedAt: new Date().toISOString() });
  }
  function save() {
    state.sessions = state.sessions.slice(0, 100);
    state.events = state.events.filter(event => state.sessions.some(session => session.id === event.sessionId)).slice(0, 1000);
    try { if (adapter) adapter.setItem(STORAGE_KEY, JSON.stringify(state)); else persistent = false; }
    catch { persistent = false; }
    return structuredClone(state);
  }
  save();
  return {
    get persistent() { return persistent; },
    getState: () => structuredClone(state),
    updateSettings(patch) { state.settings = createSettings(device.id, { ...state.settings, ...patch }); return save(); },
    saveCalibration(value) {
      if (!validateCalibration(value) || !belongs(value)) throw new TypeError('Calibración no válida');
      state.calibration = value; return save();
    },
    addSession(value) {
      if (!validateSession(value) || !belongs(value)) throw new TypeError('Sesión no válida');
      state.sessions.unshift(structuredClone(value)); return save();
    },
    updateSession(id, patch) {
      const index = state.sessions.findIndex(s => s.id === id);
      const next = { ...state.sessions[index], ...patch, id, deviceId: device.id };
      if (index < 0 || !validateSession(next)) throw new TypeError('Sesión no válida');
      state.sessions[index] = next; return save();
    },
    addEvent(value) {
      const session = state.sessions.find(s => s.id === value.sessionId);
      if (!validateEvent(value) || !session || session.status !== 'activa') throw new TypeError('Evento no válido');
      state.events.unshift(structuredClone(value)); session.totalAlerts += 1; return save();
    },
    dismissEvents(sessionId, by) {
      if (!['user_button', 'auto_awake'].includes(by)) throw new TypeError('Respuesta no válida');
      for (const event of state.events) {
        if (event.sessionId === sessionId && !event.dismissedAt) Object.assign(event, { dismissedAt: new Date().toISOString(), dismissedBy: by });
      }
      return save();
    }
  };
}
