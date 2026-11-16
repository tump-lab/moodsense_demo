import {
  AppState,
  type AppStateStatus,
  InteractionManager,
  Keyboard,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Accelerometer, Pedometer } from 'expo-sensors';
import { CONFIG } from '../../config';
import { withTimeout } from '../../services/async';
import { logEvent } from '../../services/logging';
import { hasConsent } from '../consent/store';
import {
  APP_STEPS_STREAM,
  enqueue,
  getPollWindowStart,
  latestTodayAppSteps,
  localDayKey,
  MAX_BACKFILL_MS,
  recentScreenEvents,
  setPollAnchor,
  upsert,
} from './queue';
import { inferActivity, type MotionSample } from './activityInference';
import { deriveSleepEstimates } from './sleepEstimate';
import { aggregateCategoryDurations } from './appCategories';
import { deriveBackgroundUsageSpans } from './backgroundUsage';
import {
  deriveCallSessions,
  toPackageEvents,
  toScreenEvents,
  type RawUsageEvent,
  type RawUsageEventType,
} from './usageEvents';
import { deriveSleepNights, mapHealthConnectSleepStage, mapHealthKitSleepValue, type RawSleepSegment } from './sleepNights';
import { normalizeHealthConnectExerciseType, normalizeHealthKitActivityName } from './workoutTypes';
import * as iosUsage from '../../../modules/moodsense-ios-usage';
import {
  APP_THRESHOLDS_MINUTES,
  parseAppThresholdEvents,
  parseCallSessions,
  parseCoverageSpans,
  parseProbeEvents,
  parseThresholdEvents,
  PROBE_MINUTES,
  THRESHOLDS_BY_CATEGORY,
} from './iosUsage';
import { useDevModeStore } from '../settings/devMode';
import * as bgSensing from '../../../modules/moodsense-background-sensing';
import {
  activityHourPayload,
  bucketActivityByHour,
  completedDaysSince,
  HOUR_MS,
  hourStartsBetween,
  parseBursts,
  parseMotionActivities,
  parseStepHours,
  startOfLocalDay,
  sumStepsByDay,
} from './motionHistory';

export type Teardown = () => void;

export function startAccelerometer(): Teardown {
  // On Android the sensing service samples the accelerometer around the clock (startBackgroundMotion), so a listener here would double the stream.
  if (Platform.OS === 'web' || bgSensing.isAndroidServiceAvailable) return () => {};
  return startAccelerometerListener();
}

function startAccelerometerListener(): Teardown {
  const intervalMs = CONFIG.SENSING.accelerometerIntervalMs;
  Accelerometer.setUpdateInterval(intervalMs);

  let lastEnqueuedAt = 0;
  const minGapMs = Math.max(0, intervalMs - 1000);

  const sub = Accelerometer.addListener(({ x, y, z }) => {
    if (!hasConsent('motion')) return;
    const now = Date.now();
    if (now - lastEnqueuedAt < minGapMs) return;
    lastEnqueuedAt = now;
    void enqueue('accelerometer', { x, y, z });
  });

  return () => sub.remove();
}

let stepPollInFlight: Promise<void> | null = null;

export function pollStepsOnce(): Promise<void> {
  if (!stepPollInFlight) {
    stepPollInFlight = doPollSteps().finally(() => {
      stepPollInFlight = null;
    });
  }
  return stepPollInFlight;
}

let stepCountUnavailable = false;

async function doPollSteps(): Promise<void> {
  if (stepCountUnavailable || !hasConsent('motion')) return;
  if (Platform.OS === 'web' || Platform.OS === 'android') return;
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      stepCountUnavailable = true;
      void logEvent('pedometer_unavailable', { platform: Platform.OS, reason: 'no_sensor' });
      return;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const result = await Pedometer.getStepCountAsync(start, new Date());
    if (hasConsent('motion')) await enqueue('steps', { count: result.steps });
  } catch (err) {
    stepCountUnavailable = true;
    void logEvent('pedometer_unavailable', {
      platform: Platform.OS,
      reason: 'step_count_failed',
      message: String(err instanceof Error ? err.message : err).slice(0, 200),
    });
  }
}

/**
 * Android has no step history, so this keeps a live watchStepCount listener and
 * only counts steps taken while the app runs. expo-sensors resets the count
 * whenever any listener is added, so a value that goes down is a reset, not
 * negative steps.
 */
function startAndroidStepWatch(): Teardown {
  let stopped = false;
  let sub: { remove: () => void } | null = null;
  let lastValue = 0;
  let day: { key: string; total: number } | null = null;
  let writing: Promise<void> = Promise.resolve();

  const record = (value: number) => {
    if (stopped || !hasConsent('motion')) return;
    const delta = value < lastValue ? value : value - lastValue;
    lastValue = value;
    if (delta <= 0) return;

    writing = writing.then(async () => {
      if (stopped || !hasConsent('motion')) return;
      const now = Date.now();
      const key = localDayKey(now);
      if (day == null) {
        day = { key, total: (await latestTodayAppSteps()) ?? 0 };
      } else if (day.key !== key) {
        day = { key, total: 0 };
      }
      day.total += delta;
      await upsert(APP_STEPS_STREAM, key, {
        count: day.total,
        source: 'pedometer_watch',
        partial: true,
      });
    }).catch((err) => {
      console.warn('Step accumulation error:', err);
    });
  };

  void (async () => {
    try {
      const perm = await Pedometer.requestPermissionsAsync();
      if (stopped) return;
      if (!perm.granted) {
        void logEvent('pedometer_unavailable', {
          platform: Platform.OS,
          reason: 'activity_recognition_denied',
        });
        return;
      }
      const available = await Pedometer.isAvailableAsync();
      if (stopped) return;
      if (!available) {
        void logEvent('pedometer_unavailable', { platform: Platform.OS, reason: 'no_sensor' });
        return;
      }
      sub = Pedometer.watchStepCount((result) => record(result.steps));
    } catch (err) {
      void logEvent('pedometer_unavailable', {
        platform: Platform.OS,
        reason: 'watch_failed',
        message: String(err instanceof Error ? err.message : err).slice(0, 200),
      });
    }
  })();

  return () => {
    stopped = true;
    sub?.remove();
  };
}

export function startPedometer(): Teardown {
  if (Platform.OS === 'web') return () => {};
  // The sensing service counts Android steps around the clock (startBackgroundMotion); the JS watch is only its fallback.
  if (Platform.OS === 'android') {
    return bgSensing.isAndroidServiceAvailable ? () => {} : startAndroidStepWatch();
  }

  void pollStepsOnce();
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void pollStepsOnce();
  });

  return () => sub.remove();
}

/**
 * Motion coverage for the hours MoodSense is not open. iOS runs no app code then, so it
 * reads back what CoreMotion recorded on its own; Android runs a foreground service,
 * falling back to the foreground-only listeners if the service cannot start.
 */
export function startBackgroundMotion(): Teardown {
  if (Platform.OS === 'ios') return startIosMotionHistory();
  if (Platform.OS === 'android' && bgSensing.isAndroidServiceAvailable) {
    return startAndroidSensingService();
  }
  return () => {};
}

const MOTION_HISTORY_ANCHOR = 'motion_history';
const SERVICE_STEPS_ANCHOR = 'service_steps';
const MOTION_HISTORY_POLL_MS = 60 * 60_000;
const SERVICE_DRAIN_POLL_MS = 15 * 60_000;
const BURST_DRAIN_LIMIT = 100;

let motionHistoryInFlight: Promise<void> | null = null;

/** Safe from the background task: it re-checks consent, and a platform with nothing to give is a no-op. */
export function pollMotionHistoryOnce(): Promise<void> {
  if (!motionHistoryInFlight) {
    const run =
      Platform.OS === 'ios'
        ? doPollIosMotionHistory
        : Platform.OS === 'android'
          ? drainSensingService
          : async () => {};
    motionHistoryInFlight = run()
      .catch((err) => {
        console.warn('Motion history poll error:', err);
      })
      .finally(() => {
        motionHistoryInFlight = null;
      });
  }
  return motionHistoryInFlight;
}

let motionHistoryFailureLogged = false;

function logMotionHistoryFailure(stage: string, err: unknown): void {
  if (motionHistoryFailureLogged) return;
  motionHistoryFailureLogged = true;
  void logEvent('motion_history_unavailable', {
    platform: Platform.OS,
    stage,
    message: String(err instanceof Error ? err.message : err).slice(0, 200),
  });
}

/**
 * CoreMotion keeps about seven days of activity and step history whatever the app was
 * doing, so an anchored poll after any gap recovers the whole gap. Both are written per
 * local hour.
 */
async function doPollIosMotionHistory(): Promise<void> {
  if (!hasConsent('motion')) return;
  const nowMs = Date.now();
  const floorMs = nowMs - MAX_BACKFILL_MS;
  const emitFromMs = await getPollWindowStart(MOTION_HISTORY_ANCHOR, nowMs);
  let failed = false;

  if (bgSensing.isMotionHistoryAvailable) {
    try {
      // The full retained history, not just the window: an hour's opening minutes belong to whatever activity began before it, possibly days before.
      const entries = parseMotionActivities(await bgSensing.queryMotionActivity(floorMs, nowMs));
      for (const hour of bucketActivityByHour(entries, nowMs, emitFromMs)) {
        // The hour in progress waits for the next poll's overlap: written now, it would re-upload on every poll until it closed.
        if (hour.partial) continue;
        if (!hasConsent('motion')) return;
        await upsert('activity_os', `ios:${hour.hourStart}`, activityHourPayload(hour), {
          ts: hour.hourStart,
        });
      }
    } catch (err) {
      failed = true;
      logMotionHistoryFailure('activity', err);
    }
  }

  if (!stepCountUnavailable) {
    try {
      // Hours and days reaching past CoreMotion's retention would come back short, so they are skipped rather than stored as low counts; the hour in progress waits, as above.
      for (const hourStart of hourStartsBetween(emitFromMs, nowMs)) {
        const endMs = hourStart + HOUR_MS;
        if (hourStart < floorMs || endMs > nowMs) continue;
        if (!hasConsent('motion')) return;
        const { steps } = await Pedometer.getStepCountAsync(new Date(hourStart), new Date(endMs));
        await upsert(
          'steps_hourly',
          `ios:${hourStart}`,
          { hourStart, steps, source: 'coremotion' },
          { ts: hourStart }
        );
      }
      for (const day of completedDaysSince(emitFromMs, nowMs)) {
        if (day.startTs < floorMs) continue;
        if (!hasConsent('motion')) return;
        const { steps } = await Pedometer.getStepCountAsync(new Date(day.startTs), new Date(day.endTs));
        // Stamped just before midnight so it is the day's latest `steps` row — the one every reader takes as the day's total — instead of whatever running total that day's last poll caught.
        await upsert('steps', `day:${day.key}`, { count: steps, final: true }, { ts: day.endTs - 1 });
      }
    } catch (err) {
      failed = true;
      logMotionHistoryFailure('steps', err);
    }
  }

  if (!failed) await setPollAnchor(MOTION_HISTORY_ANCHOR, nowMs);
}

function startIosMotionHistory(): Teardown {
  let stopped = false;
  const poll = () => {
    if (!stopped) void pollMotionHistoryOnce();
  };

  poll();
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') poll();
  });
  const timer = setInterval(poll, MOTION_HISTORY_POLL_MS);

  return () => {
    stopped = true;
    sub.remove();
    clearInterval(timer);
  };
}

/**
 * Hands the Android service's queue to the sensing stream. Bursts become the same
 * `accelerometer` and `activity` rows the foreground path writes, stamped with when they
 * were recorded; steps become `steps_hourly` plus the day total the step tile reads.
 */
async function drainSensingService(): Promise<void> {
  if (!bgSensing.isAndroidServiceAvailable || !hasConsent('motion')) return;

  for (;;) {
    const { bursts, maxId, rawCount } = parseBursts(await bgSensing.readBursts(BURST_DRAIN_LIMIT));
    if (maxId == null) break;
    for (const burst of bursts) {
      if (!hasConsent('motion')) return;
      const first = burst.samples[0];
      if (first) {
        await upsert(
          'accelerometer',
          `svc:${burst.ts}`,
          { x: first.x, y: first.y, z: first.z, recorder: 'service' },
          { ts: burst.ts }
        );
      }
      const { type, confidence, source, features } = inferActivity(
        burst.samples,
        burst.windowMs,
        burst.steps
      );
      await upsert(
        'activity',
        `svc:${burst.ts}`,
        { type, confidence, source, ...features, recorder: 'service' },
        { ts: burst.ts }
      );
    }
    // Acknowledged only once every row is written, so a crash part-way re-delivers rather than loses; the upsert keys make re-delivery harmless.
    await bgSensing.ackBursts(maxId);
    if (rawCount < BURST_DRAIN_LIMIT) break;
  }

  const nowMs = Date.now();
  // From a local midnight, so every day touched is read whole and its total below is complete.
  const sinceMs = startOfLocalDay(await getPollWindowStart(SERVICE_STEPS_ANCHOR, nowMs));
  const hours = parseStepHours(await bgSensing.readStepHours(sinceMs));
  for (const hour of hours) {
    // Completed hours only, for the same re-upload reason as iOS; the day total below still counts the hour in progress.
    if (hour.hourStart + HOUR_MS > nowMs) continue;
    if (!hasConsent('motion')) return;
    await upsert(
      'steps_hourly',
      `android:${hour.hourStart}`,
      {
        hourStart: hour.hourStart,
        steps: hour.steps,
        bursts: hour.bursts,
        source: 'step_counter_service',
      },
      { ts: hour.hourStart }
    );
  }
  for (const day of sumStepsByDay(hours)) {
    if (!hasConsent('motion')) return;
    // Still `partial`: the counter only runs while the service does, and hours it missed are absent, not zero.
    await upsert(
      APP_STEPS_STREAM,
      day.key,
      { count: day.steps, source: 'step_counter_service', partial: true },
      { ts: Math.min(nowMs, day.endTs - 1) }
    );
  }
  await setPollAnchor(SERVICE_STEPS_ANCHOR, nowMs);
}

async function ensureSensingService(): Promise<string> {
  const permission = await Pedometer.requestPermissionsAsync();
  if (!permission.granted) return 'permission_denied';
  return bgSensing.startService(
    CONFIG.SENSING.activityIntervalMs,
    CONFIG.SENSING.activityBurstMs,
    CONFIG.SENSING.activitySampleIntervalMs
  );
}

function startAndroidSensingService(): Teardown {
  let stopped = false;
  let fallback: Teardown | null = null;
  const drain = () => {
    if (!stopped) void pollMotionHistoryOnce();
  };
  const useFallback = (reason: string) => {
    void logEvent('background_sensing_unavailable', {
      platform: Platform.OS,
      reason: reason.slice(0, 200),
    });
    if (!stopped && fallback == null) fallback = startForegroundMotion();
  };

  void (async () => {
    try {
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        // The service runs either way; this only decides whether its ongoing notice is visible, and participants should be able to see that it is on.
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      const result = await ensureSensingService();
      if (stopped) {
        if (!hasConsent('motion')) void bgSensing.stopService(true);
        return;
      }
      if (result !== 'started') useFallback(result);
    } catch (err) {
      useFallback(String(err instanceof Error ? err.message : err));
    }
    drain();
  })();

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    // A service stopped from Android's task manager comes back the next time the app is opened.
    if (state === 'active' && fallback == null) void ensureSensingService().catch(() => {});
    if (state === 'active' || state === 'background') drain();
  });
  const timer = setInterval(drain, SERVICE_DRAIN_POLL_MS);

  return () => {
    stopped = true;
    sub.remove();
    clearInterval(timer);
    fallback?.();
    // Unmounting is not withdrawal: the service exists to outlive the UI, so only a consent change stops it, and then what it recorded but never handed over is dropped.
    if (!hasConsent('motion')) void bgSensing.stopService(true);
  };
}

/** What Android collected before the service existed: foreground-only, and only while the app is open. */
function startForegroundMotion(): Teardown {
  const stops = [startAccelerometerListener(), startActivityWindows(), startAndroidStepWatch()];
  return () => {
    for (const stop of stops) stop();
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stepsDuring(runBurst: () => Promise<void>): Promise<number | null> {
  let available = false;
  try {
    available = await Pedometer.isAvailableAsync();
  } catch {
    available = false;
  }
  if (!available) {
    await runBurst();
    return null;
  }

  let steps = 0;
  let sub: { remove: () => void } | null = null;
  try {
    sub = Pedometer.watchStepCount((result) => {
      steps = result.steps;
    });
  } catch {
    await runBurst();
    return null;
  }

  try {
    await runBurst();
  } finally {
    sub.remove();
  }
  return steps;
}

export function startActivityRecognition(): Teardown {
  // As with startAccelerometer: on Android the service's bursts feed this stream.
  if (Platform.OS === 'web' || bgSensing.isAndroidServiceAvailable) return () => {};
  return startActivityWindows();
}

/** Foreground only: expo-sensors delivers nothing to a backgrounded app, so a background window would be an empty burst. */
function startActivityWindows(): Teardown {
  let stopped = false;
  let inFlight = false;

  const runWindow = async () => {
    if (stopped || inFlight || !hasConsent('motion')) return;
    if (AppState.currentState !== 'active') return;
    inFlight = true;

    const samples: MotionSample[] = [];
    let windowMs = 0;

    try {
      const steps = await stepsDuring(async () => {
        let sub: { remove: () => void } | null = null;
        const startedAt = Date.now();
        try {
          Accelerometer.setUpdateInterval(CONFIG.SENSING.activitySampleIntervalMs);
          sub = Accelerometer.addListener(({ x, y, z }) => {
            samples.push({ x, y, z });
          });
          await delay(CONFIG.SENSING.activityBurstMs);
        } finally {
          windowMs = Date.now() - startedAt;
          sub?.remove();
          Accelerometer.setUpdateInterval(CONFIG.SENSING.accelerometerIntervalMs);
        }
      });

      if (stopped || !hasConsent('motion')) return;

      const { type, confidence, source, features } = inferActivity(samples, windowMs, steps);
      await enqueue('activity', { type, confidence, source, ...features });
    } catch (err) {
      void logEvent('activity_window_failed', {
        message: String(err instanceof Error ? err.message : err).slice(0, 200),
      });
    } finally {
      inFlight = false;
    }
  };

  void runWindow();
  const timer = setInterval(() => void runWindow(), CONFIG.SENSING.activityIntervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function startScreenProxy(): Teardown {
  let prev: AppStateStatus = AppState.currentState;

  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    const wasActive = prev === 'active';
    const isActive = next === 'active';
    prev = next;
    if (wasActive === isActive) return;
    if (!hasConsent('screen')) return;
    void enqueue('screen', {
      state: isActive ? 'active' : 'background',
      type: isActive ? 'screen_on' : 'screen_off',
      source: 'app_state',
      eventTs: Date.now(),
    });
  });

  return () => sub.remove();
}

/**
 * Read HealthKit straight from NativeModules, not from react-native-health's
 * export. That export copies methods with Object.assign, which copies nothing
 * from a new-architecture module, so every call failed with "undefined is not a
 * function".
 */
function getAppleHealthKit(): any {
  return NativeModules.AppleHealthKit;
}

function getHealthKitConstants(): any {
  const healthModuleImport = require('react-native-health');
  return (healthModuleImport.default ?? healthModuleImport).Constants;
}

function healthKitNativeModuleAvailable(): boolean {
  return Platform.OS === 'ios' && typeof getAppleHealthKit()?.initHealthKit === 'function';
}

const HEALTHKIT_MISSING_DETAIL =
  'HealthKit is not callable in this build — it needs a native dev build ' +
  '(Expo Go has no native modules); if this is a native build, rebuild it.';

/**
 * There is no "unauthorized" state on purpose: iOS hides read permission, so a
 * denied read just returns no data. `no_samples` covers both an empty window and
 * a permission that is off in the Health app.
 */
export type HealthStreamState =
  | 'idle'
  | 'consent_off'
  | 'no_native_module'
  | 'init_failed'
  | 'read_failed'
  | 'no_samples'
  | 'ok';

export interface HealthStreamStatus {
  state: HealthStreamState;
  detail: string | null;
  lastPollTs: number | null;
  lastSampleCount: number | null;
}

let healthStatus: HealthStreamStatus = {
  state: 'idle',
  detail: null,
  lastPollTs: null,
  lastSampleCount: null,
};

export function getHealthStreamStatus(): HealthStreamStatus {
  return healthStatus;
}

let lastLoggedHealthState: HealthStreamState | null = null;

function setHealthStatus(next: Partial<HealthStreamStatus> & { state: HealthStreamState }): void {
  healthStatus = { ...healthStatus, lastPollTs: Date.now(), ...next };
  if (next.state !== lastLoggedHealthState) {
    lastLoggedHealthState = next.state;
    void logEvent('health_stream_state', {
      platform: Platform.OS,
      state: next.state,
      detail: healthStatus.detail,
    });
  }
}

let healthKitInit: Promise<any> | null = null;

function ensureHealthKit(): Promise<any> {
  if (!healthKitInit) {
    healthKitInit = new Promise<any>((resolve, reject) => {
      const AppleHealthKit = getAppleHealthKit();
      if (!healthKitNativeModuleAvailable()) {
        reject(new Error(HEALTHKIT_MISSING_DETAIL));
        return;
      }
      const P = getHealthKitConstants().Permissions;
      AppleHealthKit.initHealthKit(
        {
          permissions: {
            read: [
              P.HeartRate,
              P.HeartRateVariability,
              P.RestingHeartRate,
              P.RespiratoryRate,
              P.OxygenSaturation,
              P.StepCount,
              P.Steps,
              P.ActiveEnergyBurned,
              P.Workout,
              P.SleepAnalysis,
              P.MindfulSession,
            ],
            write: [],
          },
        },
        (error: string) => (error ? reject(new Error(error)) : resolve(AppleHealthKit)),
      );
    }).catch((err) => {
      healthKitInit = null;
      throw err;
    });
  }
  return healthKitInit;
}

interface HKSample {
  id?: string;
  value: number;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
}

function hkSamples(AppleHealthKit: any, method: string, options: object): Promise<HKSample[]> {
  return new Promise((resolve, reject) => {
    if (typeof AppleHealthKit?.[method] !== 'function') {
      reject(new Error(`HealthKit method ${method} is not available in this build`));
      return;
    }
    AppleHealthKit[method](options, (error: unknown, results: HKSample[]) =>
      error ? reject(new Error(String(error))) : resolve(results ?? []),
    );
  });
}

const IOS_QUANTITY_STREAMS: Array<{
  method: string;
  stream: string;
  payload: (s: HKSample) => Record<string, unknown>;
}> = [
  { method: 'getHeartRateSamples', stream: 'health_heart_rate', payload: (s) => ({ bpm: s.value }) },
  { method: 'getRestingHeartRateSamples', stream: 'health_resting_hr', payload: (s) => ({ bpm: s.value }) },
  { method: 'getRespiratoryRateSamples', stream: 'health_respiratory_rate', payload: (s) => ({ brpm: s.value }) },
  { method: 'getOxygenSaturationSamples', stream: 'health_spo2', payload: (s) => ({ fraction: s.value }) },
];

let healthPollInFlight: Promise<void> | null = null;

export function pollHealthOnce(opts: { allowBackground?: boolean } = {}): Promise<void> {
  if (!healthPollInFlight) {
    healthPollInFlight = doPollHealth(opts).finally(() => {
      healthPollInFlight = null;
    });
  }
  return healthPollInFlight;
}

async function doPollHealth(opts: { allowBackground?: boolean }): Promise<void> {
  if (!hasConsent('health')) {
    setHealthStatus({ state: 'consent_off', detail: null });
    return;
  }
  if (!opts.allowBackground && AppState.currentState !== 'active') return;

  if (Platform.OS === 'ios' && !healthKitNativeModuleAvailable()) {
    setHealthStatus({ state: 'no_native_module', detail: HEALTHKIT_MISSING_DETAIL });
    return;
  }

  const nowMs = Date.now();
  const windowStartMs = await getPollWindowStart('health', nowMs);
  const startISO = new Date(windowStartMs).toISOString();
  const endISO = new Date(nowMs).toISOString();

  if (Platform.OS === 'ios') {
    let AppleHealthKit: any;
    try {
      AppleHealthKit = await ensureHealthKit();
    } catch (err) {
      setHealthStatus({
        state: 'init_failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      console.warn('HealthKit init failed:', err);
      return;
    }

    try {
      const windowOpts = { startDate: startISO, endDate: endISO, ascending: true };
      const counts: Record<string, number> = {};

      for (const { method, stream, payload } of IOS_QUANTITY_STREAMS) {
        if (!hasConsent('health')) return;
        const samples = await hkSamples(AppleHealthKit, method, windowOpts);
        counts[stream] = (counts[stream] ?? 0) + samples.length;
        for (const s of samples) {
          if (!hasConsent('health')) return;
          const ts = new Date(s.startDate).getTime();
          await upsert(stream, `ios:${s.id ?? ts}`, {
            ...payload(s),
            source: s.sourceName ?? s.sourceId ?? null,
            ts,
          });
        }
      }

      const dailySteps = await hkSamples(AppleHealthKit, 'getDailyStepCountSamples', {
        startDate: startISO,
        endDate: endISO,
      });
      counts['health_steps_daily'] = dailySteps.length;
      for (const s of dailySteps) {
        if (!hasConsent('health')) return;
        const ts = new Date(s.startDate).getTime();
        await upsert('health_steps_daily', `ios:${localDayKey(ts)}`, { steps: s.value, ts });
      }

      const mindful = await hkSamples(AppleHealthKit, 'getMindfulSession', windowOpts);
      counts['health_mindful'] = mindful.length;
      for (const s of mindful) {
        if (!hasConsent('health')) return;
        const startMs = new Date(s.startDate).getTime();
        const endMs = new Date(s.endDate).getTime();
        await upsert('health_mindful', `ios:${s.id ?? `${startMs}:${endMs}`}`, {
          startDate: startMs,
          endDate: endMs,
          duration: (endMs - startMs) / 1000,
        });
      }

      const workoutResults = await new Promise<{ data: Array<Record<string, any>> }>((resolve, reject) => {
        AppleHealthKit.getAnchoredWorkouts(
          { startDate: startISO, endDate: endISO, type: 'Workout' },
          (error: unknown, results: { data: Array<Record<string, any>> }) =>
            error ? reject(new Error(String(error))) : resolve(results),
        );
      });
      const workouts = workoutResults?.data ?? [];
      counts['health_workout'] = workouts.length;
      for (const workout of workouts) {
        if (!hasConsent('health')) return;
        const startMs = new Date(workout.start).getTime();
        const endMs = new Date(workout.end).getTime();
        const dedupeKey = workout.id != null ? `ios:${workout.id}` : `ios:${startMs}:${endMs}`;
        await upsert('health_workout', dedupeKey, {
          activityType: normalizeHealthKitActivityName(workout.activityName),
          startDate: startMs,
          endDate: endMs,
          duration: workout.duration,
          energyBurned: workout.calories ?? null,
          category: 'physiology',
        });
      }

      await setPollAnchor('health', nowMs);

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const breakdown = Object.entries(counts)
        .map(([stream, n]) => `${stream.replace(/^health_/, '')}=${n}`)
        .join(' ');
      setHealthStatus(
        total === 0
          ? {
              state: 'no_samples',
              detail:
                'HealthKit returned nothing for this window. If the Health app ' +
                'has data, check Health \u203A Sharing \u203A Apps \u203A MoodSense — iOS does not ' +
                'report read permission to the app.',
              lastSampleCount: 0,
            }
          : { state: 'ok', detail: breakdown, lastSampleCount: total }
      );
    } catch (err) {
      setHealthStatus({
        state: 'read_failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      console.warn('Health data collection error (iOS):', err);
    }
  }

  if (Platform.OS === 'android') {
    try {
      const HealthConnect = require('react-native-health-connect');

      const initialized = await HealthConnect.initialize();
      if (!initialized) return;

      await HealthConnect.requestPermission([
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'RestingHeartRate' },
        { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
        { accessType: 'read', recordType: 'RespiratoryRate' },
        { accessType: 'read', recordType: 'OxygenSaturation' },
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'ExerciseSession' },
      ]);

      const timeRangeFilter = {
        operator: 'between' as const,
        startTime: startISO,
        endTime: endISO,
      };

      const { records: heartRateRecords } = await HealthConnect.readRecords('HeartRate', { timeRangeFilter });
      for (const record of heartRateRecords ?? []) {
        if (!hasConsent('health')) return;
        const source = record.metadata?.dataOrigin ?? null;
        for (const sample of record.samples ?? []) {
          if (!hasConsent('health')) return;
          const ts = new Date(sample.time).getTime();
          await upsert('health_heart_rate', `android:${sample.time}`, {
            bpm: sample.beatsPerMinute,
            source,
            ts,
          });
        }
      }

      const androidInstantStreams: Array<{
        recordType: string;
        stream: string;
        payload: (r: Record<string, any>) => Record<string, unknown>;
      }> = [
        { recordType: 'RestingHeartRate', stream: 'health_resting_hr', payload: (r) => ({ bpm: r.beatsPerMinute }) },
        { recordType: 'RespiratoryRate', stream: 'health_respiratory_rate', payload: (r) => ({ brpm: r.rate }) },
        { recordType: 'OxygenSaturation', stream: 'health_spo2', payload: (r) => ({ percentage: r.percentage }) },
      ];
      for (const { recordType, stream, payload } of androidInstantStreams) {
        if (!hasConsent('health')) return;
        const { records } = await HealthConnect.readRecords(recordType, { timeRangeFilter });
        for (const record of records ?? []) {
          if (!hasConsent('health')) return;
          const ts = new Date(record.time).getTime();
          await upsert(stream, `android:${record.metadata?.id ?? record.time}`, {
            ...payload(record),
            source: record.metadata?.dataOrigin ?? null,
            ts,
          });
        }
      }

      const { records: stepRecords } = await HealthConnect.readRecords('Steps', { timeRangeFilter });
      for (const record of stepRecords ?? []) {
        if (!hasConsent('health')) return;
        const startMs = new Date(record.startTime).getTime();
        const endMs = new Date(record.endTime).getTime();
        await upsert('health_steps_interval', `android:${record.metadata?.id ?? `${startMs}:${endMs}`}`, {
          steps: record.count,
          startDate: startMs,
          endDate: endMs,
          source: record.metadata?.dataOrigin ?? null,
        });
      }

      const { records: exerciseRecords } = await HealthConnect.readRecords('ExerciseSession', { timeRangeFilter });
      for (const exercise of exerciseRecords ?? []) {
        if (!hasConsent('health')) return;
        const startMs = new Date(exercise.startTime).getTime();
        const endMs = new Date(exercise.endTime).getTime();
        const sessionId = exercise.metadata?.id;
        const dedupeKey = sessionId != null ? `android:${sessionId}` : `android:${startMs}:${endMs}`;
        await upsert('health_workout', dedupeKey, {
          activityType: normalizeHealthConnectExerciseType(exercise.exerciseType),
          startDate: startMs,
          endDate: endMs,
          duration: (endMs - startMs) / 1000,
          energyBurned: null,
          category: 'physiology',
        });
      }

      await setPollAnchor('health', nowMs);
    } catch (err) {
      console.warn('Health data collection error (Android):', err);
    }
  }
}

const IOS_OBSERVER_EVENTS = [
  'healthKit:HeartRate:new',
  'healthKit:RestingHeartRate:new',
  'healthKit:Workout:new',
];

/**
 * Brings up the OS permission sheets for the passive streams that have one, so a participant who
 * has just consented is actually asked.
 *
 * These are a different thing from the consent flags, and conflating the two is how a build ends up
 * reporting "not recorded" for every health signal on a phone whose switches are all on: a flag
 * only decides whether a collector may run, while HealthKit and Core Motion each need iOS to say
 * yes, and no app can default that to granted. Worse, HealthKit read access that was refused is not
 * an error — iOS simply returns no samples — so a denial is indistinguishable downstream from a
 * quiet day. Asking once, at the moment consent is given, is the only point where the question has
 * any context.
 *
 * Best-effort throughout: a refused sheet is a legitimate answer, and nothing here is worth
 * blocking onboarding over.
 */
/**
 * Long enough for a system sheet to finish animating out before the next one is raised. iOS
 * silently drops a permission request made while another sheet is still on screen, so without a
 * gap the second and third asks would simply never appear.
 */
const SHEET_GAP_MS = 450;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How long a single OS ask is given before it is treated as unanswered, and the ceiling on the whole
 * run. Both exist because none of these calls has a deadline of its own: `initHealthKit` answers
 * through a callback, the Screen Time pickers through a native completion block, and a sheet that
 * fails to present or is dismissed in a way the bridge does not report leaves the promise pending
 * forever. Awaiting that from ConsentOnboarding is what left the "Agree and continue" button
 * spinning with no way forward.
 *
 * A single alert gets a short budget; the Screen Time step gets a long one, because it is three
 * modal pickers the participant reads and taps through — bounded by patience, not by latency.
 */
const ASK_TIMEOUT_MS = 90_000;
const SCREEN_TIME_TIMEOUT_MS = 8 * 60_000;
const PRIME_TIMEOUT_MS = 10 * 60_000;

/** How long `whenActive` waits for the foreground before giving up on the sheets altogether. */
const ACTIVE_TIMEOUT_MS = 20_000;

/** Resolves once the app is foreground-active, so no sheet is raised behind a launch animation or
 *  while the app is sitting in the background. Rejects if the app never comes forward, since every
 *  ask after it would be dropped by the OS anyway. */
function whenActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  const active = new Promise<void>((resolve) => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') return;
      sub.remove();
      resolve();
    });
  });
  return withTimeout(active, ACTIVE_TIMEOUT_MS, 'foreground wait');
}

/**
 * Clears whatever the user was last touching before the first sheet goes up.
 *
 * Sign-up and sign-in are text-entry screens, so the keyboard is usually still up when consent is
 * accepted and this runs. A system sheet raised over a live keyboard leaves both stuck: the sheet
 * owns the touches, the keyboard still owns the bottom of the screen, and there is nothing left to
 * tap to get rid of either. Taking the keyboard down and letting the screen transition finish first
 * is what the platform apps do, and it costs a few hundred milliseconds once per account.
 */
async function settleUi(): Promise<void> {
  Keyboard.dismiss();
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  await wait(SHEET_GAP_MS);
}

export interface PrimeSensingOptions {
  /**
   * Whether the Screen Time grant and its pickers are part of this run. Onboarding leaves them out
   * and runs them itself, after its own explainer — the pickers are the one step a participant
   * cannot act on without being told what the groups are for.
   */
  includeScreenTime?: boolean;
}

/**
 * Never rejects and never hangs: every ask is time-boxed, a refusal does not stop the rest, and the
 * whole run is capped. Callers can therefore `await` it on the path to the next screen without the
 * screen depending on how any sheet went.
 */
export async function primeSensingPermissions(
  opts: PrimeSensingOptions = {}
): Promise<void> {
  const includeScreenTime = opts.includeScreenTime ?? true;
  try {
    await withTimeout(primeAll(includeScreenTime), PRIME_TIMEOUT_MS, 'permission priming');
  } catch (err) {
    // Includes the whole-run deadline. Logged rather than thrown: the asks are best-effort, and
    // the collectors all cope with a grant that never arrived.
    void logEvent('permission_prime_incomplete', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function primeAll(includeScreenTime: boolean): Promise<void> {
  await whenActive();
  await settleUi();

  let raised = false;
  /** Runs one ask, spaced from the previous one, and never lets a refusal or a silent sheet stop the rest. */
  const step = async (
    label: string,
    ask: () => Promise<unknown>,
    ms = ASK_TIMEOUT_MS
  ): Promise<void> => {
    if (raised) await wait(SHEET_GAP_MS);
    raised = true;
    try {
      await withTimeout(ask(), ms, label);
    } catch {
      // Refused, unsupported on this device, no native module, or an answer that never came. The
      // collectors all cope, and the remaining asks still get their turn.
    }
  };

  if (hasConsent('motion')) {
    await step('motion permission', () => Pedometer.requestPermissionsAsync());
  }
  if (hasConsent('health')) {
    // initHealthKit is what presents the sheet; the poll that follows needs it to have run anyway.
    await step('health permission', () => ensureHealthKit());
  }
  if (includeScreenTime && hasConsent('appUsage')) {
    // Two sheets of its own — the authorization alert, then the activity pickers — so it goes last,
    // after the single-alert asks have had their turn.
    await step(
      'screen time setup',
      async () => {
        const { runScreenTimeSetupIfUnset } = await import('./screenTimeSetup');
        await runScreenTimeSetupIfUnset();
      },
      SCREEN_TIME_TIMEOUT_MS
    );
  }
}

export function startHealthData(): Teardown {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = () => {
    if (!stopped) void pollHealthOnce();
  };

  poll();
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') poll();
  });

  const observerSubs: Array<{ remove: () => void }> = [];
  if (Platform.OS === 'ios' && NativeModules.AppleHealthKit) {
    const emitter = new NativeEventEmitter(NativeModules.AppleHealthKit);
    for (const event of IOS_OBSERVER_EVENTS) {
      observerSubs.push(
        emitter.addListener(event, () => {
          if (!stopped) void pollHealthOnce({ allowBackground: true });
        }),
      );
    }
  }

  timer = setInterval(poll, 60 * 60_000);

  return () => {
    stopped = true;
    sub.remove();
    for (const s of observerSubs) s.remove();
    if (timer != null) clearInterval(timer);
  };
}

let sleepPollInFlight: Promise<void> | null = null;

export function pollSleepOnce(): Promise<void> {
  if (!sleepPollInFlight) {
    sleepPollInFlight = doPollSleep().finally(() => {
      sleepPollInFlight = null;
    });
  }
  return sleepPollInFlight;
}

async function doPollSleep(): Promise<void> {
  if (!hasConsent('sleep')) return;

  const nowMs = Date.now();
  const windowStartMs = await getPollWindowStart('sleep', nowMs);
  const startISO = new Date(windowStartMs).toISOString();
  const endISO = new Date(nowMs).toISOString();
  let failed = false;

  const rawSegments: RawSleepSegment[] = [];

  if (Platform.OS === 'ios') {
    try {
      const AppleHealthKit = await ensureHealthKit();

      const sleepData = await hkSamples(AppleHealthKit, 'getSleepSamples', {
        startDate: startISO,
        endDate: endISO,
        ascending: true,
      });
      for (const sample of sleepData as unknown as Array<{ id?: string; startDate: string; endDate: string; value: string }>) {
        if (!hasConsent('sleep')) return;
        const startMs = new Date(sample.startDate).getTime();
        const endMs = new Date(sample.endDate).getTime();
        await upsert('sleep', `ios:${sample.id ?? `${startMs}:${endMs}:${sample.value}`}`, {
          startDate: startMs,
          endDate: endMs,
          duration: (endMs - startMs) / 1000,
          value: sample.value,
        });
        rawSegments.push({ startTs: startMs, endTs: endMs, state: mapHealthKitSleepValue(sample.value) });
      }
    } catch (err) {
      failed = true;
      console.warn('Sleep detection error (iOS):', err);
    }
  }

  if (Platform.OS === 'android') {
    try {
      const HealthConnect = require('react-native-health-connect');

      const initialized = await HealthConnect.initialize();
      if (!initialized) return;

      await HealthConnect.requestPermission([{ accessType: 'read', recordType: 'SleepSession' }]);

      const { records } = await HealthConnect.readRecords('SleepSession', {
        timeRangeFilter: {
          operator: 'between',
          startTime: startISO,
          endTime: endISO,
        },
      });
      for (const record of records ?? []) {
        if (!hasConsent('sleep')) return;
        const startMs = new Date(record.startTime).getTime();
        const endMs = new Date(record.endTime).getTime();
        await upsert('sleep', `android:${record.metadata?.id ?? `${startMs}:${endMs}`}`, {
          startTime: record.startTime,
          endTime: record.endTime,
          duration: (endMs - startMs) / 1000,
          stages: record.stages,
        });
        for (const stage of record.stages ?? []) {
          rawSegments.push({
            startTs: new Date(stage.startTime).getTime(),
            endTs: new Date(stage.endTime).getTime(),
            state: mapHealthConnectSleepStage(stage.stage),
          });
        }
      }
    } catch (err) {
      failed = true;
      console.warn('Sleep detection error (Android):', err);
    }
  }

  if (rawSegments.length > 0) {
    for (const night of deriveSleepNights(rawSegments)) {
      if (!hasConsent('sleep')) return;
      await upsert('sleep_night', night.date, night);
    }
  }

  if (!failed) await setPollAnchor('sleep', nowMs);
}

export function startSleepDetection(): Teardown {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = () => {
    if (!stopped) void pollSleepOnce();
  };

  poll();
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') poll();
  });

  let observerSub: { remove: () => void } | null = null;
  if (Platform.OS === 'ios' && NativeModules.AppleHealthKit) {
    const emitter = new NativeEventEmitter(NativeModules.AppleHealthKit);
    observerSub = emitter.addListener('healthKit:SleepAnalysis:new', poll);
  }

  timer = setInterval(poll, 6 * 60 * 60_000);

  return () => {
    stopped = true;
    sub.remove();
    observerSub?.remove();
    if (timer != null) clearInterval(timer);
  };
}

const SLEEP_ESTIMATE_LOOKBACK_MS = 48 * 60 * 60_000;

let sleepEstimateInFlight: Promise<void> | null = null;

export function pollSleepEstimateOnce(): Promise<void> {
  if (!sleepEstimateInFlight) {
    sleepEstimateInFlight = doPollSleepEstimate().finally(() => {
      sleepEstimateInFlight = null;
    });
  }
  return sleepEstimateInFlight;
}

async function doPollSleepEstimate(): Promise<void> {
  if (!hasConsent('sleep') || !hasConsent('screen')) return;
  try {
    const events = await recentScreenEvents(Date.now() - SLEEP_ESTIMATE_LOOKBACK_MS);
    for (const night of deriveSleepEstimates(events)) {
      if (!hasConsent('sleep') || !hasConsent('screen')) return;
      await upsert('sleep_night_estimated', night.date, night);
    }
  } catch (err) {
    console.warn('Sleep estimate error:', err);
  }
}

export function startSleepEstimate(): Teardown {
  let stopped = false;

  const poll = () => {
    if (!stopped) void pollSleepEstimateOnce();
  };

  poll();
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') poll();
  });

  const timer = setInterval(poll, 6 * 60 * 60_000);

  return () => {
    stopped = true;
    sub.remove();
    clearInterval(timer);
  };
}

let usagePermissionPromptedThisSession = false;

let appUsagePollInFlight: Promise<void> | null = null;

export function pollAppUsageOnce(): Promise<void> {
  if (!appUsagePollInFlight) {
    appUsagePollInFlight = aggregateAndSendUsage().finally(() => {
      appUsagePollInFlight = null;
    });
  }
  return appUsagePollInFlight;
}

type UsageStat = { packageName: string; totalForegroundTime: number; lastUsageTime: number };

const APP_USAGE_DAYS_ANCHOR = 'app_usage_days';

function readUsageRange(usageModule: any, startMs: number, endMs: number): Promise<UsageStat[]> {
  return new Promise((resolve) => {
    usageModule.getUsageCustomRange(String(startMs), String(endMs), (result: UsageStat[]) =>
      resolve(result ?? [])
    );
  });
}

function usagePayload(stats: UsageStat[]): Record<string, unknown> {
  return {
    totalForegroundTimeMs: stats.reduce((sum, s) => sum + (s.totalForegroundTime ?? 0), 0),
    appCount: stats.length,
    topApps: [...stats]
      .sort((a, b) => (b.totalForegroundTime ?? 0) - (a.totalForegroundTime ?? 0))
      .slice(0, 5)
      .map((s) => ({ packageName: s.packageName, duration: s.totalForegroundTime })),
    categoryDurationsMs: aggregateCategoryDurations(stats),
  };
}

async function aggregateAndSendUsage(): Promise<void> {
  if (!hasConsent('appUsage')) return;

  // react-native-app-usage's iOS module is only a stub with example methods, so
  // app usage is Android-only. Skip iOS instead of writing empty rows that look
  // like real data.
  if (Platform.OS !== 'android') return;

  try {
    const usageModule = require('react-native-app-usage');

    const granted: boolean = await usageModule.checkPackagePermission();
    if (!granted) {
      // Usage Access has no normal permission prompt, only a jump to the Settings
      // screen. Do it at most once per session and never from the background, so we
      // don't pull people out of what they are doing.
      if (!usagePermissionPromptedThisSession && AppState.currentState === 'active') {
        usagePermissionPromptedThisSession = true;
        usageModule.requestUsagePermission();
      }
      return;
    }

    const nowMs = Date.now();
    const stats = await readUsageRange(usageModule, startOfLocalDay(nowMs), nowMs);
    if (hasConsent('appUsage')) await enqueue('app_usage', usagePayload(stats));

    // Today's row is only as late as the last poll, so a day whose last poll came mid-afternoon would keep an afternoon total.
    // Once a day is over its full total is written, stamped just before midnight so it is the row every reader takes for that day.
    // Days before the backfill floor are skipped: UsageStats keeps daily buckets for about a week and answers older ranges from coarser ones.
    const floorMs = nowMs - MAX_BACKFILL_MS;
    const windowStartMs = await getPollWindowStart(APP_USAGE_DAYS_ANCHOR, nowMs);
    for (const day of completedDaysSince(windowStartMs, nowMs)) {
      if (day.startTs < floorMs) continue;
      const dayStats = await readUsageRange(usageModule, day.startTs, day.endTs);
      if (!hasConsent('appUsage')) return;
      await upsert(
        'app_usage',
        `day:${day.key}`,
        { ...usagePayload(dayStats), final: true },
        { ts: day.endTs - 1 }
      );
    }
    await setPollAnchor(APP_USAGE_DAYS_ANCHOR, nowMs);
  } catch (err) {
    console.warn('App usage tracking error:', err);
  }
}

export function startAppUsageTracking(): Teardown {
  void pollAppUsageOnce();
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background') void pollAppUsageOnce();
  });
  const timer = setInterval(() => void pollAppUsageOnce(), 24 * 60 * 60_000);

  return () => {
    sub.remove();
    clearInterval(timer);
  };
}

const USAGE_EVENT_POLL_MS = 30 * 60_000;
const USAGE_EVENT_ANCHOR = 'usage_events';

const RAW_USAGE_EVENT_TYPES: ReadonlySet<string> = new Set<RawUsageEventType>([
  'activity_resumed',
  'activity_paused',
  'screen_interactive',
  'screen_non_interactive',
  'keyguard_shown',
  'keyguard_hidden',
  'foreground_service_start',
  'foreground_service_stop',
]);

function parseUsageEvents(raw: unknown): RawUsageEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: RawUsageEvent[] = [];
  for (const item of raw) {
    const type = (item as { type?: unknown })?.type;
    const ts = (item as { ts?: unknown })?.ts;
    if (typeof type !== 'string' || !RAW_USAGE_EVENT_TYPES.has(type)) continue;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    const packageName = (item as { packageName?: unknown })?.packageName;
    out.push({
      type: type as RawUsageEventType,
      ts,
      packageName: typeof packageName === 'string' ? packageName : undefined,
    });
  }
  return out;
}

let usageEventsUnavailableLogged = false;

async function doPollUsageEvents(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!hasConsent('screen') && !hasConsent('calls') && !hasConsent('appUsage')) return;

  let usageModule: {
    checkPackagePermission: () => Promise<boolean>;
    getUsageEvents?: (start: string, end: string, cb: (result: unknown) => void) => void;
  };
  try {
    usageModule = require('react-native-app-usage');
  } catch {
    return;
  }

  if (typeof usageModule.getUsageEvents !== 'function') {
    if (!usageEventsUnavailableLogged) {
      usageEventsUnavailableLogged = true;
      console.warn(
        '[sensing] react-native-app-usage has no getUsageEvents; ' +
          'falling back to the AppState screen proxy. Run `npx patch-package`.'
      );
    }
    return;
  }

  const granted = await usageModule.checkPackagePermission();
  if (!granted) return;

  const now = Date.now();
  const windowStart = await getPollWindowStart(USAGE_EVENT_ANCHOR, now);
  const raw = await new Promise<unknown>((resolve) => {
    usageModule.getUsageEvents!(String(windowStart), String(now), resolve);
  });
  const events = parseUsageEvents(raw);
  if (events.length === 0) {
    await setPollAnchor(USAGE_EVENT_ANCHOR, now);
    return;
  }

  if (hasConsent('screen')) {
    for (const event of toScreenEvents(events)) {
      await upsert('screen', `os:${event.type}:${event.ts}`, {
        type: event.type,
        state: event.type === 'screen_on' || event.type === 'screen_unlock' ? 'active' : 'background',
        source: 'usage_events',
        eventTs: event.ts,
      });
    }
  }

  if (hasConsent('calls')) {
    for (const call of deriveCallSessions(events)) {
      await upsert('call', `call:${call.startTs}`, {
        startTs: call.startTs,
        endTs: call.endTs,
        durationMs: call.durationMs,
        packageName: call.packageName,
        estimated: call.estimated,
        method: call.method,
        eventTs: call.startTs,
      });
    }
  }

  if (hasConsent('appUsage')) {
    for (const span of deriveBackgroundUsageSpans(toPackageEvents(events))) {
      await upsert('background_usage', `bg:${span.packageName}:${span.startTs}`, {
        packageName: span.packageName,
        category: span.category,
        startTs: span.startTs,
        endTs: span.endTs,
        durationMs: span.durationMs,
        eventTs: span.startTs,
      });
    }
  }

  await setPollAnchor(USAGE_EVENT_ANCHOR, now);
}

let usageEventPollInFlight: Promise<void> | null = null;

export function pollUsageEventsOnce(): Promise<void> {
  if (usageEventPollInFlight) return usageEventPollInFlight;
  usageEventPollInFlight = doPollUsageEvents()
    .catch((err) => {
      console.warn('Usage event poll error:', err);
    })
    .finally(() => {
      usageEventPollInFlight = null;
    });
  return usageEventPollInFlight;
}

export function startUsageEventPolling(): Teardown {
  void pollUsageEventsOnce();

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active' || state === 'background') void pollUsageEventsOnce();
  });
  const timer = setInterval(() => void pollUsageEventsOnce(), USAGE_EVENT_POLL_MS);

  return () => {
    sub.remove();
    clearInterval(timer);
  };
}

const IOS_USAGE_POLL_MS = 15 * 60_000;

/** Marks a row as a real device unlock rather than a MoodSense open; queue.ts reads it to keep the two apart. */
const IOS_SCREEN_SOURCE = 'ios_protected_data';

let iosUsagePollInFlight: Promise<void> | null = null;

async function doPollIosUsage(): Promise<void> {
  if (Platform.OS !== 'ios' || !iosUsage.isAvailable) return;

  if (hasConsent('screen')) {
    // Real device unlocks, queued natively while the app was in the background. Written under the
    // same `screen` stream as the AppState proxy but with a different `source`, which is what lets
    // queue.ts count phone pick-ups and MoodSense opens as the two different things they are.
    for (const event of await iosUsage.drainScreenEvents()) {
      if (!hasConsent('screen')) return;
      if (typeof event?.ts !== 'number' || !Number.isFinite(event.ts)) continue;
      if (event.type !== 'screen_unlock' && event.type !== 'screen_lock') continue;
      await upsert('screen', `ios:${event.type}:${event.ts}`, {
        type: event.type,
        state: event.type === 'screen_unlock' ? 'active' : 'background',
        source: IOS_SCREEN_SOURCE,
        eventTs: event.ts,
      });
    }
  }

  if (hasConsent('calls')) {
    const rawSessions = await iosUsage.drainCallSessions();
    const rawCoverage = await iosUsage.drainCallCoverage();
    // Coverage is the tell: spans and no sessions means the observer ran and there were no calls,
    // while no spans at all means it was never listening, which is a bug rather than a quiet day.
    // Only those two cases are logged; a healthy poll every 15 minutes is not worth uploading.
    const sessionCount = Array.isArray(rawSessions) ? rawSessions.length : 0;
    const coverageCount = Array.isArray(rawCoverage) ? rawCoverage.length : 0;
    if (sessionCount > 0 || coverageCount === 0) {
      void logEvent('ios_call_poll', {
        sessions: sessionCount,
        coverageSpans: coverageCount,
        keepAlive: await iosUsage.callKeepAliveStatus(),
      });
    }
    for (const session of parseCallSessions(rawSessions)) {
      if (!hasConsent('calls')) return;
      await upsert('call', `callkit:${session.startTs}`, {
        startTs: session.startTs,
        endTs: session.endTs,
        durationMs: session.durationMs,
        outgoing: session.outgoing,
        partial: session.partial,
        packageName: null,
        estimated: false,
        method: 'callkit',
        eventTs: session.startTs,
      });
    }
    // An open span is written without an end so it is not re-uploaded on every poll; it gets one when it closes.
    for (const span of parseCoverageSpans(rawCoverage)) {
      if (!hasConsent('calls')) return;
      await upsert('call_coverage', `callkit:${span.startTs}`, {
        startTs: span.startTs,
        endTs: span.open ? null : span.endTs,
        open: span.open,
        eventTs: span.startTs,
      });
    }
  }

  if (hasConsent('appUsage')) {
    // The appId -> participant-typed name map. Keyed by appId alone, so renaming an app updates its
    // row in place; `upsert` re-uploads only when the payload actually changed, which makes this
    // safe to write on every poll. Without it a per-app row is an anonymous code and nothing more.
    for (const [appId, name] of Object.entries(await iosUsage.appLabels())) {
      if (!hasConsent('appUsage')) return;
      if (typeof name !== 'string' || name.trim() === '') continue;
      await upsert('app_label', `ios:${appId}`, {
        appId,
        name: name.trim(),
        source: 'participant',
        eventTs: Date.now(),
      });
    }

    const raw = await iosUsage.drainUsageThresholdEvents();
    if (Array.isArray(raw) && raw.length > 0) {
      // Raw names, not parsed rows: a name the parsers reject would otherwise vanish without trace.
      void logEvent('ios_usage_drain', { names: raw.map((e) => (e as { name?: unknown })?.name) });
    }
    for (const crossing of parseProbeEvents(raw)) {
      if (!hasConsent('appUsage')) return;
      // Its own stream, so a debug rung can never be read back as study data.
      await upsert(
        'app_usage_probe',
        `ios:${localDayKey(crossing.ts)}:${crossing.category}:${crossing.thresholdMinutes}`,
        {
          category: crossing.category,
          thresholdMinutes: crossing.thresholdMinutes,
          day: localDayKey(crossing.ts),
          eventTs: crossing.ts,
        },
      );
    }
    for (const crossing of parseThresholdEvents(raw)) {
      if (!hasConsent('appUsage')) return;
      await upsert(
        'app_usage_threshold',
        `ios:${localDayKey(crossing.ts)}:${crossing.category}:${crossing.thresholdMinutes}`,
        {
          category: crossing.category,
          thresholdMinutes: crossing.thresholdMinutes,
          day: localDayKey(crossing.ts),
          atLeastMinutes: crossing.thresholdMinutes,
          eventTs: crossing.ts,
        },
      );
    }
    // Per-app rows share the stream under category 'app', which the group readers in queue.ts skip.
    for (const crossing of parseAppThresholdEvents(raw)) {
      if (!hasConsent('appUsage')) return;
      const day = localDayKey(crossing.ts);
      await upsert('app_usage_threshold', `ios:${day}:app:${crossing.appId}:${crossing.thresholdMinutes}`, {
        category: 'app',
        appId: crossing.appId,
        thresholdMinutes: crossing.thresholdMinutes,
        day,
        atLeastMinutes: crossing.thresholdMinutes,
        eventTs: crossing.ts,
      });
    }
  }
}

export function pollIosUsageOnce(): Promise<void> {
  if (iosUsagePollInFlight) return iosUsagePollInFlight;
  iosUsagePollInFlight = doPollIosUsage()
    .catch((err) => {
      console.warn('iOS usage poll error:', err);
    })
    .finally(() => {
      iosUsagePollInFlight = null;
    });
  return iosUsagePollInFlight;
}

/** syncIosUsageMonitoring runs on every foreground, so an unchanged answer is not worth a row. */
let lastUsageMonitoringSignature: string | null = null;

/**
 * Reports why the Screen Time chain is or is not running. Every step of it fails soft and produces the
 * same zero rows, so each early return says which step it was — this is the only signal that separates
 * "no entitlement" from "nothing picked" from "live, just not crossed yet".
 */
async function logUsageMonitoringState(
  outcome: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  let diagnostics: iosUsage.UsageDiagnostics | null = null;
  try {
    diagnostics = await iosUsage.usageDiagnostics();
  } catch {
    // Diagnostics are best-effort; never let them swallow the outcome they were meant to explain.
  }
  // Deliberately excludes the pending-event count, which changes on its own and would defeat the guard.
  const signature = JSON.stringify([
    outcome,
    extra,
    diagnostics?.authorization,
    diagnostics?.selections,
    diagnostics?.monitoredEventCount,
    diagnostics?.activityRegistered,
  ]);
  if (signature === lastUsageMonitoringSignature) return;
  lastUsageMonitoringSignature = signature;

  console.warn('[sensing] ios usage monitoring:', outcome, extra, diagnostics);
  void logEvent('ios_usage_monitoring', { outcome, ...extra, diagnostics });
}

export async function syncIosUsageMonitoring(): Promise<string[]> {
  if (Platform.OS !== 'ios' || !iosUsage.isScreenTimeConfigured) {
    // Not a failure worth a row on Android, but on iOS it means the build has no App Group and can never collect.
    if (Platform.OS === 'ios') await logUsageMonitoringState('not_configured');
    return [];
  }
  if (!hasConsent('appUsage')) {
    await iosUsage.stopUsageMonitoring();
    await logUsageMonitoringState('consent_off');
    return [];
  }
  const authorization = await iosUsage.screenTimeAuthorizationStatus();
  if (authorization !== 'approved') {
    // Authorization is required on every build, dev included; without it the picker refuses to open too.
    await logUsageMonitoringState('not_authorized', { authorization });
    return [];
  }
  // The probe only exists to make a test cheap, so it is tied to the same switch that reveals the raw stream view.
  const probeMinutes = useDevModeStore.getState().enabled ? PROBE_MINUTES : 0;
  try {
    const names = await iosUsage.startUsageMonitoring(
      THRESHOLDS_BY_CATEGORY,
      APP_THRESHOLDS_MINUTES,
      probeMinutes
    );
    await logUsageMonitoringState(names.length > 0 ? 'started' : 'nothing_to_monitor', {
      eventCount: names.length,
      probeMinutes,
    });
    return names;
  } catch (err) {
    await logUsageMonitoringState('start_failed', {
      probeMinutes,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function startIosUsage(): Teardown {
  if (Platform.OS !== 'ios' || !iosUsage.isAvailable) return () => {};

  let stopped = false;
  const poll = () => {
    if (!stopped) void pollIosUsageOnce();
  };

  // Native code keeps both observers running across launches on its own (CallSensing.swift); this only passes on consent.
  const callsOn = hasConsent('calls');
  const screenOn = hasConsent('screen');
  void iosUsage.setCallSensingEnabled(callsOn);
  void iosUsage.setScreenSensingEnabled(screenOn);
  void logEvent('ios_usage_started', {
    calls: callsOn,
    screen: screenOn,
    appUsage: hasConsent('appUsage'),
    screenTimeConfigured: iosUsage.isScreenTimeConfigured,
  });
  void syncIosUsageMonitoring();
  poll();

  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') return;
    poll();
    void syncIosUsageMonitoring();
  });
  const timer = setInterval(poll, IOS_USAGE_POLL_MS);

  return () => {
    stopped = true;
    sub.remove();
    clearInterval(timer);
    // Unmounting is not withdrawal, so both observers keep running natively unless consent was turned off.
    if (!hasConsent('calls')) void iosUsage.setCallSensingEnabled(false);
    if (!hasConsent('screen')) void iosUsage.setScreenSensingEnabled(false);
  };
}
