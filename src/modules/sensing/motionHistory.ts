/**
 * Pure logic for motion recorded while MoodSense itself was not running: CoreMotion's
 * activity history on iOS, and the Android sensing service's bursts and hourly steps.
 * Rows are bucketed by local clock hour and keyed by the hour's start, so re-reading an
 * overlapping window re-derives the same rows and upsert() leaves them alone.
 * No native imports, so scripts/selfcheck-sensing.ts covers all of it.
 */
import type { MotionSample } from './activityInference';
import { localDayKey } from './queue';

export const HOUR_MS = 60 * 60_000;

export type OsActivityType =
  | 'stationary'
  | 'walking'
  | 'running'
  | 'automotive'
  | 'cycling'
  | 'unknown';

export const OS_ACTIVITY_TYPES: readonly OsActivityType[] = [
  'stationary',
  'walking',
  'running',
  'automotive',
  'cycling',
  'unknown',
];

/**
 * CoreMotion sets several flags at once — `automotive` stays on at a red light while
 * `stationary` turns on too — so the most specific flag decides the label.
 */
const FLAG_PRIORITY: readonly OsActivityType[] = [
  'automotive',
  'cycling',
  'running',
  'walking',
  'stationary',
];

export function startOfLocalHour(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Steps a calendar day rather than adding 24h, so a DST day still ends at local midnight. */
function nextLocalMidnight(ts: number): number {
  const d = new Date(startOfLocalDay(ts));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function hourStartsBetween(fromTs: number, toTs: number): number[] {
  const out: number[] = [];
  for (let h = startOfLocalHour(fromTs); h < toTs; h += HOUR_MS) out.push(h);
  return out;
}

export interface LocalDay {
  key: string;
  startTs: number;
  endTs: number;
}

/** Every local day from the one containing `fromTs` up to, not including, today. */
export function completedDaysSince(fromTs: number, nowTs: number): LocalDay[] {
  const out: LocalDay[] = [];
  const today = startOfLocalDay(nowTs);
  for (let start = startOfLocalDay(fromTs); start < today; start = nextLocalMidnight(start)) {
    out.push({ key: localDayKey(start), startTs: start, endTs: nextLocalMidnight(start) });
  }
  return out;
}

export interface MotionActivityEntry {
  ts: number;
  type: OsActivityType;
  lowConfidence: boolean;
}

export function parseMotionActivities(raw: unknown): MotionActivityEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MotionActivityEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) continue;
    out.push({
      ts: r.ts,
      type: FLAG_PRIORITY.find((flag) => r[flag] === true) ?? 'unknown',
      // CMMotionActivityConfidence: 0 low, 1 medium, 2 high.
      lowConfidence: r.confidence === 0,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export interface ActivityHour {
  hourStart: number;
  minutes: Record<OsActivityType, number>;
  lowConfidenceMin: number;
  /** Minutes of the hour CoreMotion accounted for; under 60 at the edge of its history or for the hour in progress. */
  coveredMin: number;
  partial: boolean;
}

function toMinutes(ms: number): number {
  return Math.round(ms / 6_000) / 10;
}

/**
 * Each entry lasts until the next one starts, and the last until `endTs`. Nothing is
 * emitted before the first entry: the state then is unknown, and a zero would claim
 * otherwise. Hours starting before `emitFromTs`'s hour are dropped, so a caller can pass
 * the full history for context and still write only the hours it owns.
 */
export function bucketActivityByHour(
  entries: MotionActivityEntry[],
  endTs: number,
  emitFromTs: number
): ActivityHour[] {
  const byHour = new Map<number, { ms: Record<OsActivityType, number>; lowMs: number }>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const end = Math.min(i + 1 < entries.length ? entries[i + 1].ts : endTs, endTs);
    let cursor = entry.ts;
    while (cursor < end) {
      const hourStart = startOfLocalHour(cursor);
      const sliceEnd = Math.min(end, Math.max(hourStart + HOUR_MS, cursor + 1));
      let bucket = byHour.get(hourStart);
      if (!bucket) {
        bucket = { ms: zeroByType(), lowMs: 0 };
        byHour.set(hourStart, bucket);
      }
      bucket.ms[entry.type] += sliceEnd - cursor;
      if (entry.lowConfidence) bucket.lowMs += sliceEnd - cursor;
      cursor = sliceEnd;
    }
  }

  const firstHour = startOfLocalHour(emitFromTs);
  return [...byHour.entries()]
    .filter(([hourStart]) => hourStart >= firstHour)
    .sort(([a], [b]) => a - b)
    .map(([hourStart, bucket]) => {
      const minutes = zeroByType();
      let coveredMs = 0;
      for (const type of OS_ACTIVITY_TYPES) {
        minutes[type] = toMinutes(bucket.ms[type]);
        coveredMs += bucket.ms[type];
      }
      return {
        hourStart,
        minutes,
        lowConfidenceMin: toMinutes(bucket.lowMs),
        coveredMin: toMinutes(coveredMs),
        partial: hourStart + HOUR_MS > endTs,
      };
    });
}

function zeroByType(): Record<OsActivityType, number> {
  return { stationary: 0, walking: 0, running: 0, automotive: 0, cycling: 0, unknown: 0 };
}

/** Flat fields rather than a nested map, so each is directly queryable once mirrored to Firestore. */
export function activityHourPayload(hour: ActivityHour): Record<string, unknown> {
  return {
    hourStart: hour.hourStart,
    stationaryMin: hour.minutes.stationary,
    walkingMin: hour.minutes.walking,
    runningMin: hour.minutes.running,
    automotiveMin: hour.minutes.automotive,
    cyclingMin: hour.minutes.cycling,
    unknownMin: hour.minutes.unknown,
    lowConfidenceMin: hour.lowConfidenceMin,
    coveredMin: hour.coveredMin,
    source: 'coremotion',
  };
}

export interface StepHour {
  hourStart: number;
  steps: number;
  /** Bursts the Android service ran in this hour: 12 is full coverage at a 5-minute cadence, fewer means Doze or downtime. */
  bursts: number | null;
}

export function parseStepHours(raw: unknown): StepHour[] {
  if (!Array.isArray(raw)) return [];
  const out: StepHour[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown> | null;
    if (typeof r?.hourStart !== 'number' || !Number.isFinite(r.hourStart)) continue;
    if (typeof r.steps !== 'number' || !Number.isFinite(r.steps) || r.steps < 0) continue;
    out.push({
      hourStart: r.hourStart,
      steps: r.steps,
      bursts: typeof r.bursts === 'number' && Number.isFinite(r.bursts) ? r.bursts : null,
    });
  }
  return out.sort((a, b) => a.hourStart - b.hourStart);
}

export function sumStepsByDay(hours: StepHour[]): Array<LocalDay & { steps: number }> {
  const byDay = new Map<string, LocalDay & { steps: number }>();
  for (const hour of hours) {
    const key = localDayKey(hour.hourStart);
    let day = byDay.get(key);
    if (!day) {
      const startTs = startOfLocalDay(hour.hourStart);
      day = { key, startTs, endTs: nextLocalMidnight(startTs), steps: 0 };
      byDay.set(key, day);
    }
    day.steps += hour.steps;
  }
  return [...byDay.values()].sort((a, b) => a.startTs - b.startTs);
}

export interface ServiceBurst {
  id: number;
  ts: number;
  windowMs: number;
  steps: number | null;
  samples: MotionSample[];
}

export interface ParsedBursts {
  bursts: ServiceBurst[];
  /** Highest id seen, malformed rows included, so acknowledging it clears those too instead of re-reading them forever. */
  maxId: number | null;
  rawCount: number;
}

export function parseBursts(raw: unknown): ParsedBursts {
  if (!Array.isArray(raw)) return { bursts: [], maxId: null, rawCount: 0 };
  const bursts: ServiceBurst[] = [];
  let maxId: number | null = null;
  for (const item of raw) {
    const r = item as Record<string, unknown> | null;
    if (typeof r?.id !== 'number' || !Number.isFinite(r.id)) continue;
    if (maxId == null || r.id > maxId) maxId = r.id;
    if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) continue;
    if (typeof r.windowMs !== 'number' || !Number.isFinite(r.windowMs)) continue;
    const samples = parseSamples(r.samples);
    if (samples == null) continue;
    bursts.push({
      id: r.id,
      ts: r.ts,
      windowMs: r.windowMs,
      steps: typeof r.steps === 'number' && Number.isFinite(r.steps) ? r.steps : null,
      samples,
    });
  }
  return { bursts, maxId, rawCount: raw.length };
}

function parseSamples(raw: unknown): MotionSample[] | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: MotionSample[] = [];
  for (const s of parsed) {
    if (!Array.isArray(s) || s.length !== 3) continue;
    const [x, y, z] = s;
    if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ x, y, z });
  }
  return out;
}
