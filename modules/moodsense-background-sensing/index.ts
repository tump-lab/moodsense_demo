/**
 * JS face of the local native module. iOS: reads back CoreMotion's own activity history.
 * Android: runs the foreground sensing service and hands over what it recorded.
 * Safe on any platform: without the module every function resolves to an empty result or
 * `'unavailable'` instead of throwing. Results are left `unknown` on purpose — parsing lives
 * in src/modules/sensing/motionHistory.ts, where the self-check can reach it.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface ServiceStatus {
  enabled: boolean;
  running: boolean;
  activityRecognitionGranted: boolean;
}

interface NativeBackgroundSensingModule {
  queryMotionActivity?(startMs: number, endMs: number): Promise<unknown>;

  startService?(intervalMs: number, burstMs: number, sampleIntervalMs: number): Promise<string>;
  stopService?(discardPending: boolean): Promise<boolean>;
  serviceStatus?(): Promise<ServiceStatus>;
  readBursts?(limit: number): Promise<unknown>;
  ackBursts?(throughId: number): Promise<boolean>;
  readStepHours?(sinceMs: number): Promise<unknown>;
}

const native = requireOptionalNativeModule<NativeBackgroundSensingModule>(
  'MoodSenseBackgroundSensing'
);

export const isMotionHistoryAvailable: boolean =
  Platform.OS === 'ios' && typeof native?.queryMotionActivity === 'function';

export const isAndroidServiceAvailable: boolean =
  Platform.OS === 'android' && typeof native?.startService === 'function';

export async function queryMotionActivity(startMs: number, endMs: number): Promise<unknown> {
  if (!isMotionHistoryAvailable) return [];
  return native!.queryMotionActivity!(startMs, endMs);
}

/**
 * Resolves `'started'`, or why not: `'disabled'`, `'permission_denied'` (ACTIVITY_RECOGNITION,
 * which the service's `health` type requires), `'start_failed: …'`, or `'unavailable'`.
 * Idempotent — calling it on a running service changes nothing.
 */
export async function startService(
  intervalMs: number,
  burstMs: number,
  sampleIntervalMs: number
): Promise<string> {
  if (!isAndroidServiceAvailable) return 'unavailable';
  return native!.startService!(intervalMs, burstMs, sampleIntervalMs);
}

/** `discardPending` drops everything recorded but not yet drained; pass true when motion consent is withdrawn. */
export async function stopService(discardPending: boolean): Promise<void> {
  if (!isAndroidServiceAvailable) return;
  await native!.stopService!(discardPending);
}

export async function serviceStatus(): Promise<ServiceStatus | null> {
  if (!isAndroidServiceAvailable) return null;
  return native!.serviceStatus!();
}

/** Oldest first. Not removed until ackBursts, so a crash mid-drain re-delivers instead of losing. */
export async function readBursts(limit: number): Promise<unknown> {
  if (!isAndroidServiceAvailable) return [];
  return native!.readBursts!(limit);
}

export async function ackBursts(throughId: number): Promise<void> {
  if (!isAndroidServiceAvailable) return;
  await native!.ackBursts!(throughId);
}

export async function readStepHours(sinceMs: number): Promise<unknown> {
  if (!isAndroidServiceAvailable) return [];
  return native!.readStepHours!(sinceMs);
}
