import { getSound } from './entities.js';

export class Alarm {
  constructor(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.Context = Context;
    this.context = null;
    this.master = null;
    this.nodes = new Set();
    this.buffer = null;
    this.preparedId = null;
    this.timer = null;
    this.active = false;
  }
  async unlock() {
    if (!this.Context) throw new Error('Este navegador no admite audio. Usa Chrome, Edge o Safari actualizado.');
    if (!this.context) {
      this.context = new this.Context();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
  }
  async prepare(sound, signal) {
    this.buffer = null;
    this.preparedId = sound.id;
    if (sound.type === 'file') {
      const response = await fetch(sound.filePath, { signal });
      if (!response.ok) throw new Error('No se pudo cargar el sonido seleccionado.');
      this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    }
  }
  start(settings) {
    this.stop();
    if (!this.context || this.context.state !== 'running') throw new Error('El audio está suspendido. Pulsa Activar sonido.');
    this.settings = settings;
    this.sound = getSound(settings.soundId);
    this.startedAt = performance.now();
    this.note = 0;
    this.active = true;
    if (this.sound.type === 'file') {
      if (!this.buffer || this.preparedId !== this.sound.id) { this.active = false; throw new Error('Sonido no preparado. Vuelve a iniciar la vigilancia.'); }
      this.source = this.context.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.loop = true;
      this.source.connect(this.master);
      this.nodes.add(this.source);
      this.source.start();
    }
    this.tick();
  }
  tick() {
    if (!this.active) return;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const escalation = this.settings.escalation ? Math.min(1, elapsed / 18) : 0;
    const level = this.settings.volume * (this.settings.escalation ? 0.2 + 0.8 * escalation : 1);
    this.master.gain.setTargetAtTime(level * 0.3, this.context.currentTime, 0.06);
    let interval = 500;
    if (this.sound.type === 'synth') {
      interval = this.sound.durationSec * 1000 / this.sound.melodyDefinition.length * (1 - escalation * 0.5);
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = this.sound.intensity === 'suave' ? 'sine' : 'triangle';
      oscillator.frequency.value = this.sound.melodyDefinition[this.note++ % this.sound.melodyDefinition.length];
      const now = this.context.currentTime;
      envelope.gain.setValueAtTime(0.001, now);
      envelope.gain.exponentialRampToValueAtTime(0.8, now + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      oscillator.connect(envelope).connect(this.master);
      this.nodes.add(oscillator);
      oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start();
      oscillator.stop(now + 0.26);
    } else {
      this.source.playbackRate.setTargetAtTime(1 + escalation * 0.2, this.context.currentTime, 0.1);
    }
    if (this.settings.vibration) globalThis.navigator?.vibrate?.([150, 100, 150]);
    this.timer = setTimeout(() => this.tick(), interval);
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    for (const node of this.nodes) { try { node.stop(); } catch { /* Ya terminó. */ } node.disconnect(); }
    this.nodes.clear();
    this.source = null;
    globalThis.navigator?.vibrate?.(0);
  }
  async close() {
    this.stop();
    const context = this.context;
    this.context = this.master = this.buffer = null;
    this.preparedId = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
