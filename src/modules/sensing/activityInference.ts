/**
 * Labels what the participant was doing during a short window, from a burst of accelerometer samples plus the pedometer's step count.
 * The features are stored next to the label so the dataset can be re-classified later with better thresholds.
 */

export interface MotionSample {
  x: number;
  y: number;
  z: number;
}

/**
 * `moving` means clearly not still but not step-like either, such as a handled phone or a passenger in a car.
 * It does not claim `vehicle` because the app lacks the signals to tell a car ride from a fidgeting hand.
 */
export type InferredActivity = 'still' | 'walking' | 'running' | 'moving' | 'unknown';

export interface ActivityFeatures {
  sampleCount: number;
  windowMs: number;
  meanG: number;
  sdG: number;
  peakRateHz: number;
  steps: number | null;
  stepsPerMin: number | null;
}

export interface ActivityInference {
  type: InferredActivity;
  /** A 0-1 margin from the deciding threshold, not a probability; nothing here is calibrated against ground truth. */
  confidence: number;
  source: 'steps' | 'motion' | 'none';
  features: ActivityFeatures;
}

// Starting points from typical accelerometry ranges for a phone in a pocket or hand, not from a calibration run on this cohort.
// Exported so a validation pass and the self-check use the same numbers.

export const STILL_SD_G = 0.02;
export const MOVING_SD_G = 0.05;
export const RUNNING_SD_G = 0.55;
export const RUNNING_STEPS_PER_MIN = 140;
export const WALKING_STEPS_PER_MIN = 15;
export const STEP_BAND_HZ: readonly [number, number] = [1.2, 3.6];
export const MIN_SAMPLES = 16;

const PEAK_PROMINENCE_SD = 0.5;
const PEAK_REFRACTORY_MS = 200;

function magnitude(s: MotionSample): number {
  return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
}

function peakRateHz(values: number[], mean: number, sd: number, windowMs: number): number {
  if (values.length < 3 || windowMs <= 0 || sd <= 0) return 0;
  const threshold = mean + PEAK_PROMINENCE_SD * sd;
  const perSampleMs = windowMs / values.length;
  const refractorySamples = Math.max(1, Math.round(PEAK_REFRACTORY_MS / perSampleMs));

  let peaks = 0;
  let lastPeakIndex = -Infinity;
  for (let i = 1; i < values.length - 1; i++) {
    const v = values[i];
    if (v < threshold) continue;
    if (v < values[i - 1] || v <= values[i + 1]) continue;
    if (i - lastPeakIndex < refractorySamples) continue;
    peaks += 1;
    lastPeakIndex = i;
  }
  return peaks / (windowMs / 1000);
}

export function extractFeatures(
  samples: MotionSample[],
  windowMs: number,
  steps: number | null
): ActivityFeatures {
  const magnitudes = samples.map(magnitude);
  const n = magnitudes.length;
  const mean = n > 0 ? magnitudes.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 0 ? magnitudes.reduce((acc, m) => acc + (m - mean) * (m - mean), 0) / n : 0;
  const sd = Math.sqrt(variance);

  return {
    sampleCount: n,
    windowMs,
    meanG: round(mean, 4),
    sdG: round(sd, 4),
    peakRateHz: round(peakRateHz(magnitudes, mean, sd, windowMs), 3),
    steps,
    stepsPerMin:
      steps == null || windowMs <= 0 ? null : round(steps / (windowMs / 60_000), 1),
  };
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function margin(value: number, threshold: number, scale: number): number {
  if (scale <= 0) return 0.5;
  return round(Math.min(1, Math.max(0, Math.abs(value - threshold) / scale)), 2);
}

/**
 * Order matters: too-short first, then the pedometer, then the accelerometer alone.
 * The pedometer leads because it has the OS's own filtering, but it cannot separate walking from running or see non-step motion, so the accelerometer decides those.
 */
export function classifyActivity(f: ActivityFeatures): ActivityInference {
  if (f.sampleCount < MIN_SAMPLES || f.windowMs <= 0) {
    return { type: 'unknown', confidence: 0, source: 'none', features: f };
  }

  const stepping =
    f.stepsPerMin != null
      ? f.stepsPerMin >= WALKING_STEPS_PER_MIN
      : f.peakRateHz >= STEP_BAND_HZ[0] &&
        f.peakRateHz <= STEP_BAND_HZ[1] &&
        f.sdG >= MOVING_SD_G;
  const source: ActivityInference['source'] = f.stepsPerMin != null ? 'steps' : 'motion';

  if (stepping) {
    const running = f.sdG >= RUNNING_SD_G || (f.stepsPerMin ?? 0) >= RUNNING_STEPS_PER_MIN;
    return {
      type: running ? 'running' : 'walking',
      confidence:
        f.stepsPerMin != null
          ? Math.max(
              margin(f.stepsPerMin, RUNNING_STEPS_PER_MIN, RUNNING_STEPS_PER_MIN / 2),
              margin(f.sdG, RUNNING_SD_G, RUNNING_SD_G)
            )
          : margin(f.sdG, RUNNING_SD_G, RUNNING_SD_G),
      source,
      features: f,
    };
  }

  if (f.sdG >= MOVING_SD_G) {
    return {
      type: 'moving',
      confidence: margin(f.sdG, MOVING_SD_G, MOVING_SD_G * 4),
      source: 'motion',
      features: f,
    };
  }

  return {
    type: 'still',
    confidence: margin(f.sdG, STILL_SD_G, STILL_SD_G * 2),
    source: f.stepsPerMin != null ? 'steps' : 'motion',
    features: f,
  };
}

export function inferActivity(
  samples: MotionSample[],
  windowMs: number,
  steps: number | null
): ActivityInference {
  return classifyActivity(extractFeatures(samples, windowMs, steps));
}
