import { extractMetrics } from './detector.js';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
export function summarizeCalibration(samples) {
  if (samples.length < 24) throw new Error('Faltan muestras. Mantén el rostro quieto, mira al frente y abre los ojos.');
  const baselineEyeRatio = median(samples.map(sample => sample.ear));
  const baselineHeadPitch = median(samples.map(sample => sample.pitch));
  if (baselineEyeRatio < 0.15 || baselineEyeRatio > 0.6) throw new Error('No pudimos calibrar los ojos. Ábrelos y mejora la iluminación.');
  if (samples.filter(sample => Math.abs(sample.pitch - baselineHeadPitch) > 6).length > samples.length * 0.15) {
    throw new Error('La cabeza se movió demasiado. Repite mirando al frente.');
  }
  return { baselineEyeRatio, baselineHeadPitch };
}
const NEEDED_SAMPLES = 40;
const WINDOW_MS = 5000;
const TIMEOUT_MS = 45000;
export async function calibrate(video, landmarker, signal, onProgress) {
  const samples = [];
  let lastTime = -1, lostSince = null;
  const startedAt = performance.now();
  while (performance.now() - startedAt < TIMEOUT_MS) {
    signal.throwIfAborted();
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      const metrics = extractMetrics(result.faceLandmarks[0], video.videoHeight / video.videoWidth);
      if (metrics && metrics.ear > 0.12 && metrics.mouthRatio < 0.62) {
        lostSince = null;
        samples.push({ ...metrics, at: now });
        const recent = samples.filter(sample => now - sample.at <= WINDOW_MS).length;
        onProgress(Math.min(1, recent / NEEDED_SAMPLES), 'Mira al frente con los ojos abiertos.');
        if (recent >= NEEDED_SAMPLES) return summarizeCalibration(samples.filter(sample => now - sample.at <= WINDOW_MS));
      } else {
        lostSince ??= now;
        onProgress(0, 'Centra el rostro, abre los ojos y busca buena luz.');
        if (now - lostSince > 900) { samples.length = 0; lostSince = null; }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('No se pudo completar la calibración. Mejora la luz y vuelve a intentar.');
}
