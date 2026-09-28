import { extractMetrics } from './detector.js';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
export function summarizeCalibration(samples) {
  if (samples.length < 40) throw new Error('Faltan muestras. Mantén el rostro visible y bien iluminado.');
  const baselineEyeRatio = median(samples.map(sample => sample.ear));
  const baselineHeadPitch = median(samples.map(sample => sample.pitch));
  if (baselineEyeRatio < 0.15 || baselineEyeRatio > 0.6) throw new Error('No pudimos calibrar los ojos. Ábrelos y mejora la iluminación.');
  if (samples.filter(sample => Math.abs(sample.pitch - baselineHeadPitch) > 6).length > samples.length * 0.15) {
    throw new Error('La cabeza se movió demasiado. Repite mirando al frente.');
  }
  return { baselineEyeRatio, baselineHeadPitch };
}
export async function calibrate(video, landmarker, signal, onProgress) {
  let samples = [], stableSince = null, lastTime = -1, lostSince = null;
  const startedAt = performance.now();
  while (performance.now() - startedAt < 30000) {
    signal.throwIfAborted();
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      const metrics = extractMetrics(result.faceLandmarks[0], video.videoHeight / video.videoWidth);
      if (metrics && metrics.ear > 0.15 && metrics.mouthRatio < 0.5) {
        lostSince = null;
        stableSince ??= now;
        samples.push(metrics);
        const progress = Math.min(1, (now - stableSince) / 5000);
        onProgress(progress, 'Mira al frente con los ojos abiertos.');
        if (progress === 1) return summarizeCalibration(samples);
      } else {
        lostSince ??= now;
        if (now - lostSince > 300) { stableSince = null; samples = []; }
        onProgress(0, 'Centra el rostro, abre los ojos y busca buena luz.');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 65));
  }
  throw new Error('No se pudo completar la calibración. Mejora la luz y vuelve a intentar.');
}
