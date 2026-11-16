/**
 * Turns the two iOS-only native signals (CallKit call length, DeviceActivity threshold crossings) into rows.
 * iOS reports only that a declared threshold was crossed, never minutes, so these rows go to `app_usage_threshold` and must not be pooled with Android's `app_usage` totals.
 */
import type {
  RawCallSession,
  RawCoverageSpan,
  RawThresholdEvent,
  UsageCategory,
} from '../../../modules/moodsense-ios-usage';

export type { UsageCategory };

/**
 * Every 15 minutes up to 4h, so the recorded floor is never more than 15 minutes under the real time.
 * Changing a ladder changes the measurement; existing rows keep the threshold they were recorded against.
 *
 * The step used to be 5 minutes. Every rung is one DeviceActivityEvent, and the three groups plus the
 * per-app ladders came to ~512 events in a single activity — well past anything Apple has ever shown
 * working, and DeviceActivity's response to an oversized plan is to deliver nothing at all rather than
 * to complain. These ladders keep the whole plan under ScreenTimeController.eventBudget. Raise them
 * again only alongside evidence from the `ios_usage_monitoring` log event that the plan still starts.
 */
export const USAGE_THRESHOLDS_MINUTES: readonly number[] = ladder(15, 240);

/**
 * Whole-device screen time runs longer, capped at 8h because beyond that the number stops telling people apart.
 */
export const TOTAL_THRESHOLDS_MINUTES: readonly number[] = ladder(30, 480);

/**
 * Coarser than the groups because every app picked one by one adds a full ladder of events for iOS to track
 * (ScreenTimeController.maxTrackedApps caps how many apps get one).
 */
export const APP_THRESHOLDS_MINUTES: readonly number[] = ladder(60, 240);

/**
 * Developer-mode only: one extra rung per group, low enough to confirm the whole chain in a minute
 * rather than a quarter of an hour. One minute is the floor — DeviceActivity thresholds are
 * minute-granular, so a sub-minute DateComponents is not honoured and 30 seconds cannot be measured
 * on iOS at all. Probe rows go to their own stream, never to app_usage_threshold.
 */
export const PROBE_MINUTES = 1;

function ladder(stepMinutes: number, maxMinutes: number): number[] {
  return Array.from({ length: Math.floor(maxMinutes / stepMinutes) }, (_, i) => (i + 1) * stepMinutes);
}

function fmtLadderMinutes(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes} min`;
}

/** "every 15 min up to 4h": the full list is too long to show. Assumes an evenly spaced ladder, as all of the above are. */
export function describeLadder(minutes: readonly number[]): string {
  if (minutes.length === 0) return 'never';
  return `every ${fmtLadderMinutes(minutes[0])} up to ${fmtLadderMinutes(minutes[minutes.length - 1])}`;
}

export const USAGE_CATEGORIES: readonly UsageCategory[] = ['social', 'audioVideo', 'total'];

export const THRESHOLDS_BY_CATEGORY: Record<UsageCategory, readonly number[]> = {
  social: USAGE_THRESHOLDS_MINUTES,
  audioVideo: USAGE_THRESHOLDS_MINUTES,
  total: TOTAL_THRESHOLDS_MINUTES,
};

export interface ThresholdCrossing {
  category: UsageCategory;
  thresholdMinutes: number;
  ts: number;
}

const CATEGORY_SET = new Set<string>(USAGE_CATEGORIES);

/**
 * Strict on purpose: the native extension can be older than the JS after an OTA update, so an unknown event name is dropped rather than guessed at.
 */
export function parseThresholdEvents(raw: unknown): ThresholdCrossing[] {
  if (!Array.isArray(raw)) return [];
  const out: ThresholdCrossing[] = [];
  for (const item of raw as RawThresholdEvent[]) {
    const name = (item as { name?: unknown })?.name;
    const ts = (item as { ts?: unknown })?.ts;
    if (typeof name !== 'string') continue;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue;

    const separator = name.lastIndexOf('.');
    if (separator <= 0) continue;
    const category = name.slice(0, separator);
    if (!CATEGORY_SET.has(category)) continue;

    const thresholdMinutes = Number(name.slice(separator + 1));
    if (!Number.isInteger(thresholdMinutes) || thresholdMinutes <= 0) continue;

    out.push({ category: category as UsageCategory, thresholdMinutes, ts });
  }
  return out;
}

export interface AppThresholdCrossing {
  /** Anonymous and device-specific: iOS never says which app a token is, so this only groups rows for the same app. */
  appId: string;
  thresholdMinutes: number;
  ts: number;
}

const APP_EVENT_NAME = /^app_([0-9a-f]{12})\.([1-9]\d*)$/;

/** Per-app events are named `app_<id>.<minutes>` by ScreenTimeController; parseThresholdEvents drops them. */
export function parseAppThresholdEvents(raw: unknown): AppThresholdCrossing[] {
  if (!Array.isArray(raw)) return [];
  const out: AppThresholdCrossing[] = [];
  for (const item of raw as RawThresholdEvent[]) {
    const name = (item as { name?: unknown })?.name;
    const ts = (item as { ts?: unknown })?.ts;
    if (typeof name !== 'string') continue;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue;
    const match = APP_EVENT_NAME.exec(name);
    if (!match) continue;
    out.push({ appId: match[1], thresholdMinutes: Number(match[2]), ts });
  }
  return out;
}

/** Probe events are named `<category>.p<minutes>` by ScreenTimeController; both parsers above drop them. */
const PROBE_EVENT_NAME = /^(social|audioVideo|total)\.p([1-9]\d*)$/;

export interface ProbeCrossing {
  category: UsageCategory;
  thresholdMinutes: number;
  ts: number;
}

export function parseProbeEvents(raw: unknown): ProbeCrossing[] {
  if (!Array.isArray(raw)) return [];
  const out: ProbeCrossing[] = [];
  for (const item of raw as RawThresholdEvent[]) {
    const name = (item as { name?: unknown })?.name;
    const ts = (item as { ts?: unknown })?.ts;
    if (typeof name !== 'string') continue;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue;
    const match = PROBE_EVENT_NAME.exec(name);
    if (!match) continue;
    out.push({
      category: match[1] as UsageCategory,
      thresholdMinutes: Number(match[2]),
      ts,
    });
  }
  return out;
}

export interface IosCallSession {
  startTs: number;
  endTs: number;
  durationMs: number;
  outgoing: boolean;
  /** The call was already under way when the observer started, so the duration is a lower bound. */
  partial: boolean;
}

export function parseCallSessions(raw: unknown): IosCallSession[] {
  if (!Array.isArray(raw)) return [];
  const out: IosCallSession[] = [];
  for (const item of raw as RawCallSession[]) {
    const startTs = (item as { startTs?: unknown })?.startTs;
    const endTs = (item as { endTs?: unknown })?.endTs;
    if (typeof startTs !== 'number' || !Number.isFinite(startTs) || startTs <= 0) continue;
    if (typeof endTs !== 'number' || !Number.isFinite(endTs) || endTs <= startTs) continue;
    out.push({
      startTs,
      endTs,
      durationMs: endTs - startTs,
      outgoing: (item as { outgoing?: unknown })?.outgoing === true,
      partial: (item as { partial?: unknown })?.partial === true,
    });
  }
  return out;
}

export interface CoverageSpan {
  startTs: number;
  endTs: number;
  /** Still running at the last drain, so `endTs` is only the latest heartbeat. */
  open: boolean;
}

/** When the call observer was actually running; a call outside every span could not have been seen. */
export function parseCoverageSpans(raw: unknown): CoverageSpan[] {
  if (!Array.isArray(raw)) return [];
  const out: CoverageSpan[] = [];
  for (const item of raw as RawCoverageSpan[]) {
    const startTs = (item as { startTs?: unknown })?.startTs;
    const endTs = (item as { endTs?: unknown })?.endTs;
    if (typeof startTs !== 'number' || !Number.isFinite(startTs) || startTs <= 0) continue;
    if (typeof endTs !== 'number' || !Number.isFinite(endTs) || endTs < startTs) continue;
    out.push({ startTs, endTs, open: (item as { open?: unknown })?.open === true });
  }
  return out;
}

/**
 * Null is not zero: no crossing can mean under 15 minutes or a monitor that was never set up.
 * A value is a lower bound, so 30 means at least 30 minutes.
 */
export function highestThresholdByCategory(
  crossings: ThresholdCrossing[],
): Record<UsageCategory, number | null> {
  const highest: Record<UsageCategory, number | null> = {
    social: null,
    audioVideo: null,
    total: null,
  };
  for (const crossing of crossings) {
    const current = highest[crossing.category];
    if (current == null || crossing.thresholdMinutes > current) {
      highest[crossing.category] = crossing.thresholdMinutes;
    }
  }
  return highest;
}
