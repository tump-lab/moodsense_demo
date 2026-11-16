/**
 * Local queue for passive-sensing events, stored in the `sensing_events` table.
 * The db module is imported lazily inside each function so plain Node (the self-check script) can import `chunk` without loading native code.
 */

import type { ScreenEvent, ScreenSummary } from './screenSessions';

type DbModule = typeof import('../../services/db');
type FirebaseModule = typeof import('../../services/firebase');
type UploaderModule = typeof import('./uploader');

function db(): Promise<DbModule> {
  return import('../../services/db');
}

function firebaseSvc(): Promise<FirebaseModule> {
  return import('../../services/firebase');
}

function uploader(): Promise<UploaderModule> {
  return import('./uploader');
}

function nudgeUploader(): void {
  void uploader()
    .then((m) => m.scheduleFlush())
    .catch(() => {
    });
}

export function startOfToday(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight yesterday. Steps back a calendar day instead of subtracting 24h so a DST day still lands on local midnight. */
export function startOfYesterday(now: Date = new Date()): number {
  const d = new Date(startOfToday(now));
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function localDayKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** `ts` defaults to now; pass it for data recorded earlier (backfill, the Android service's queue) so day-window readers file the row under the day it describes. */
export interface WriteOptions {
  ts?: number;
}

export async function enqueue(
  stream: string,
  payload: object,
  opts: WriteOptions = {}
): Promise<void> {
  const { exec } = await db();
  const { getActiveUid } = await firebaseSvc();
  await exec(
    'INSERT INTO sensing_events (stream, ts, payload, uploaded, uid) VALUES (?, ?, ?, 0, ?)',
    [stream, opts.ts ?? Date.now(), JSON.stringify(payload), getActiveUid()]
  );
  nudgeUploader();
}

export async function upsert(
  stream: string,
  dedupeKey: string,
  payload: object,
  opts: WriteOptions = {}
): Promise<void> {
  const { exec } = await db();
  const { getActiveUid } = await firebaseSvc();
  // The WHERE clause makes a re-upsert with the same payload a no-op, so overlapping polls don't re-mark and re-upload unchanged rows.
  const result = await exec(
    `INSERT INTO sensing_events (stream, ts, payload, uploaded, uid, dedupe_key)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(uid, stream, dedupe_key) DO UPDATE SET
       ts = excluded.ts, payload = excluded.payload, uploaded = 0
     WHERE excluded.payload <> sensing_events.payload`,
    [stream, opts.ts ?? Date.now(), JSON.stringify(payload), getActiveUid(), dedupeKey]
  );
  if (result.changes > 0) nudgeUploader();
}

export async function pendingCount(): Promise<number> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sensing_events WHERE uploaded = 0 AND uid = ?',
    [getActiveUid()]
  );
  return rows[0]?.n ?? 0;
}

export async function hasAnyStreamRow(stream: string): Promise<boolean> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ x: number }>(
    'SELECT 1 AS x FROM sensing_events WHERE stream = ? AND uid = ? LIMIT 1',
    [stream, getActiveUid()]
  );
  return rows.length > 0;
}

interface DayWindow {
  sinceTs: number;
  untilTs: number | null;
}

const TODAY = (): DayWindow => ({ sinceTs: startOfToday(), untilTs: null });
const YESTERDAY = (): DayWindow => ({ sinceTs: startOfYesterday(), untilTs: startOfToday() });

function upperBound(w: DayWindow): { sql: string; params: number[] } {
  return w.untilTs == null ? { sql: '', params: [] } : { sql: 'AND ts < ? ', params: [w.untilTs] };
}

async function countByStreamBetween(w: DayWindow): Promise<Record<string, number>> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const cap = upperBound(w);
  const rows = await queryAll<{ stream: string; n: number }>(
    `SELECT stream, COUNT(*) AS n FROM sensing_events
     WHERE ts >= ? ${cap.sql}AND uid = ? GROUP BY stream`,
    [w.sinceTs, ...cap.params, getActiveUid()]
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.stream] = row.n;
  return out;
}

export function todayCountByStream(): Promise<Record<string, number>> {
  return countByStreamBetween(TODAY());
}

export function yesterdayCountByStream(): Promise<Record<string, number>> {
  return countByStreamBetween(YESTERDAY());
}

/**
 * Times MoodSense itself was opened, which is what the AppState proxy — and only the AppState proxy —
 * records. It used to be counted as "unlocks" across every `state: "active"` row, which was already
 * wrong on Android and became actively misleading once real iOS unlocks started landing in the same
 * stream: a phone pick-up and an app open are different events and are now counted separately.
 */
async function appOpenCountBetween(w: DayWindow): Promise<number> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const cap = upperBound(w);
  const rows = await queryAll<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sensing_events
     WHERE stream = 'screen' AND ts >= ? ${cap.sql}AND payload LIKE '%"state":"active"%'
       AND payload LIKE '%"source":"app_state"%' AND uid = ?`,
    [w.sinceTs, ...cap.params, getActiveUid()]
  );
  return rows[0]?.n ?? 0;
}

export function todayAppOpenCount(): Promise<number> {
  return appOpenCountBetween(TODAY());
}

export function yesterdayAppOpenCount(): Promise<number> {
  return appOpenCountBetween(YESTERDAY());
}

async function latestStepsBetween(w: DayWindow, stream: string): Promise<number | null> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const cap = upperBound(w);
  const rows = await queryAll<{ payload: string }>(
    `SELECT payload FROM sensing_events
     WHERE stream = ? AND ts >= ? ${cap.sql}AND uid = ? ORDER BY ts DESC LIMIT 1`,
    [stream, w.sinceTs, ...cap.params, getActiveUid()]
  );
  const raw = rows[0]?.payload;
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { count?: unknown }).count === 'number'
    ) {
      return (parsed as { count: number }).count;
    }
  } catch {
  }
  return null;
}

export const APP_STEPS_STREAM = 'steps_foreground';

export function latestTodaySteps(): Promise<number | null> {
  return latestStepsBetween(TODAY(), 'steps');
}

export function latestYesterdaySteps(): Promise<number | null> {
  return latestStepsBetween(YESTERDAY(), 'steps');
}

export function latestTodayAppSteps(): Promise<number | null> {
  return latestStepsBetween(TODAY(), APP_STEPS_STREAM);
}

export function latestYesterdayAppSteps(): Promise<number | null> {
  return latestStepsBetween(YESTERDAY(), APP_STEPS_STREAM);
}

export interface SleepNightSummary {
  date: string;
  onsetTs: number;
  wakeTs: number;
  totalAsleepMs: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface RecentSleepRow {
  date: string;
  onsetTs: number;
  wakeTs: number;
  totalAsleepMs: number;
}

async function latestRecentSleepRow<T extends RecentSleepRow>(
  stream: 'sleep_night' | 'sleep_night_estimated'
): Promise<T | null> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ payload: string }>(
    `SELECT payload FROM sensing_events
     WHERE stream = ? AND uid = ? ORDER BY dedupe_key DESC LIMIT 1`,
    [stream, getActiveUid()]
  );
  const raw = rows[0]?.payload;
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as T).date === 'string' &&
      typeof (parsed as T).onsetTs === 'number' &&
      typeof (parsed as T).wakeTs === 'number' &&
      typeof (parsed as T).totalAsleepMs === 'number'
    ) {
      const summary = parsed as T;
      const now = new Date();
      const today = localDateStr(now);
      const yesterday = localDateStr(new Date(now.getTime() - ONE_DAY_MS));
      if (summary.date !== today && summary.date !== yesterday) return null;
      return summary;
    }
  } catch {
  }
  return null;
}

export async function latestSleepNight(): Promise<SleepNightSummary | null> {
  return latestRecentSleepRow<SleepNightSummary>('sleep_night');
}

export type SleepNightEstimateSummary = RecentSleepRow;

export async function latestSleepNightEstimate(): Promise<SleepNightEstimateSummary | null> {
  return latestRecentSleepRow<SleepNightEstimateSummary>('sleep_night_estimated');
}

const SCREEN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'screen_on',
  'screen_off',
  'screen_unlock',
  'screen_lock',
]);

/**
 * Which collector's view of the screen a day is built from. They are not interchangeable:
 * `usage_events` sees the screen itself waking, `ios_protected_data` sees only unlocks (a glance at
 * the lock screen never engages data protection), and `app_state` sees only MoodSense opening.
 */
export type ScreenSource = 'usage_events' | 'ios_protected_data' | 'app_state';

const OS_SCREEN_SOURCES: ReadonlySet<string> = new Set<ScreenSource>([
  'usage_events',
  'ios_protected_data',
]);

/**
 * True only where a sub-15s session means what `summarizeScreenSessions` thinks it means. iOS evicts
 * the data protection keys about ten seconds after the screen locks, so every session derived from
 * `ios_protected_data` runs that much long and the glance/use split on it is noise, not a finding.
 */
export function screenSourceSeesGlances(source: ScreenSource | null): boolean {
  return source === 'usage_events' || source === 'app_state';
}

export async function recentScreenEvents(sinceTs: number): Promise<ScreenEvent[]> {
  return (await screenEventsBetween({ sinceTs, untilTs: null })).events;
}

/**
 * Filters on `payload.eventTs` (the real event time) rather than row `ts`, because Android usage polls write past events in batches after the fact.
 * When any OS event exists, the AppState proxy rows are dropped: both describe the same screen, so mixing them double-counts.
 * The winning source is returned with the events, because what a count of them means depends on which one it was.
 */
async function screenEventsBetween(
  w: DayWindow
): Promise<{ events: ScreenEvent[]; source: ScreenSource | null }> {
  const { sinceTs, untilTs } = w;
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ ts: number; payload: string }>(
    `SELECT ts, payload FROM sensing_events
     WHERE stream = 'screen' AND ts >= ? AND uid = ? ORDER BY ts ASC`,
    [sinceTs, getActiveUid()]
  );
  const fromOs: ScreenEvent[] = [];
  const fromProxy: ScreenEvent[] = [];
  let osSource: ScreenSource | null = null;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as {
        type?: unknown;
        eventTs?: unknown;
        source?: unknown;
      };
      const t = parsed?.type;
      if (typeof t !== 'string' || !SCREEN_EVENT_TYPES.has(t)) continue;
      const eventTs =
        typeof parsed.eventTs === 'number' && Number.isFinite(parsed.eventTs)
          ? parsed.eventTs
          : row.ts;
      if (eventTs < sinceTs) continue;
      if (untilTs != null && eventTs >= untilTs) continue;
      const event = { type: t as ScreenEvent['type'], ts: eventTs };
      if (typeof parsed.source === 'string' && OS_SCREEN_SOURCES.has(parsed.source)) {
        fromOs.push(event);
        osSource = parsed.source as ScreenSource;
      } else {
        fromProxy.push(event);
      }
    } catch {
    }
  }
  const useOs = fromOs.length > 0;
  const events = useOs ? fromOs : fromProxy;
  return {
    events: events.sort((a, b) => a.ts - b.ts),
    source: events.length === 0 ? null : useOs ? osSource : 'app_state',
  };
}

export interface LatestSample {
  value: number;
  ts: number;
}

export async function latestSample(stream: string, field: string): Promise<LatestSample | null> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ ts: number; payload: string }>(
    `SELECT ts, payload FROM sensing_events
     WHERE stream = ? AND uid = ? ORDER BY ts DESC LIMIT 1`,
    [stream, getActiveUid()]
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (typeof parsed === 'object' && parsed !== null) {
      const v = (parsed as Record<string, unknown>)[field];
      if (typeof v === 'number' && Number.isFinite(v)) return { value: v, ts: row.ts };
    }
  } catch {
  }
  return null;
}

async function screenTimeMsBetween(w: DayWindow): Promise<number | null> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const cap = upperBound(w);
  const rows = await queryAll<{ payload: string }>(
    `SELECT payload FROM sensing_events
     WHERE stream = 'app_usage' AND ts >= ? ${cap.sql}AND uid = ? ORDER BY ts DESC LIMIT 1`,
    [w.sinceTs, ...cap.params, getActiveUid()]
  );
  const raw = rows[0]?.payload;
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const v = (parsed as { totalForegroundTimeMs?: unknown })?.totalForegroundTimeMs;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  } catch {
  }
  return null;
}

export function todayScreenTimeMs(): Promise<number | null> {
  return screenTimeMsBetween(TODAY());
}

export function yesterdayScreenTimeMs(): Promise<number | null> {
  return screenTimeMsBetween(YESTERDAY());
}

/**
 * One individually tracked app's day. `atLeastMinutes` is a floor, never a total — iOS reports only
 * that an hourly rung was crossed. `name` is what the participant called it and is absent until they
 * do; `appId` is the anonymous code the rows are actually filed under.
 */
export interface AppUsage {
  appId: string;
  name: string | null;
  atLeastMinutes: number;
}

export interface UsageDigest {
  screen: ScreenSummary | null;
  /** Phone pick-ups: real device unlocks. Null when the day's source cannot see unlocks at all, which must never render as zero. */
  unlocks: number | null;
  /** Times MoodSense itself was opened — a different question from how often the phone was picked up. */
  appOpens: number | null;
  screenSource: ScreenSource | null;
  socialMs: number | null;
  audioVideoMs: number | null;
  callMs: number | null;
  socialThresholdMin: number | null;
  audioVideoThresholdMin: number | null;
  totalThresholdMin: number | null;
  /** Per-app floors, highest rung per app, named where the participant named them. Empty on Android, which has real durations instead. */
  apps: AppUsage[];
}

async function categoryDurationsBetween(w: DayWindow): Promise<{
  socialMs: number | null;
  audioVideoMs: number | null;
  callMs: number | null;
}> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const cap = upperBound(w);
  const rows = await queryAll<{ payload: string }>(
    `SELECT payload FROM sensing_events
     WHERE stream = 'app_usage' AND ts >= ? ${cap.sql}AND uid = ? ORDER BY ts DESC LIMIT 1`,
    [w.sinceTs, ...cap.params, getActiveUid()]
  );
  const raw = rows[0]?.payload;
  if (raw == null) return { socialMs: null, audioVideoMs: null, callMs: null };
  try {
    const parsed = JSON.parse(raw) as { categoryDurationsMs?: Record<string, unknown> };
    const c = parsed?.categoryDurationsMs;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      socialMs: num(c?.social),
      audioVideoMs: num(c?.audioVideo),
      callMs: num(c?.call),
    };
  } catch {
    return { socialMs: null, audioVideoMs: null, callMs: null };
  }
}

/**
 * Filed by `payload.eventTs` (when the call happened), not row `ts` (when the poll wrote it).
 * iOS queues finished calls natively and only hands them over when the app next runs, so a call
 * is routinely written hours — or a day — after it ended; bucketing by row `ts` put it on the
 * wrong day and left the day it actually happened showing no calls at all.
 *
 * The row `ts` lower bound is still safe to push into SQL: a call is never written before it ends,
 * so `ts >= eventTs` always holds. There is deliberately no upper bound, because that is exactly
 * the row a late write would fall outside of.
 */
async function callSessionMsBetween(w: DayWindow): Promise<number | null> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ ts: number; payload: string }>(
    `SELECT ts, payload FROM sensing_events
     WHERE stream = 'call' AND ts >= ? AND uid = ?`,
    [w.sinceTs, getActiveUid()]
  );
  let total: number | null = null;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { durationMs?: unknown; eventTs?: unknown };
      // Rows written before this field existed fall back to the row's own timestamp.
      const eventTs =
        typeof parsed?.eventTs === 'number' && Number.isFinite(parsed.eventTs)
          ? parsed.eventTs
          : row.ts;
      if (eventTs < w.sinceTs) continue;
      if (w.untilTs != null && eventTs >= w.untilTs) continue;
      if (typeof parsed?.durationMs !== 'number' || !Number.isFinite(parsed.durationMs)) continue;
      total = (total ?? 0) + parsed.durationMs;
    } catch {
    }
  }
  return total;
}

/** appId -> the participant's name for it, from the rows `collectors.ts` writes on every iOS poll. */
async function appLabelsFor(uid: string): Promise<Record<string, string>> {
  const { queryAll } = await db();
  const rows = await queryAll<{ payload: string }>(
    `SELECT payload FROM sensing_events WHERE stream = 'app_label' AND uid = ?`,
    [uid]
  );
  const labels: Record<string, string> = {};
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { appId?: unknown; name?: unknown };
      if (typeof parsed?.appId === 'string' && typeof parsed?.name === 'string' && parsed.name) {
        labels[parsed.appId] = parsed.name;
      }
    } catch {
    }
  }
  return labels;
}

async function usageThresholdsBetween(w: DayWindow): Promise<{
  socialThresholdMin: number | null;
  audioVideoThresholdMin: number | null;
  totalThresholdMin: number | null;
  apps: AppUsage[];
}> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const cap = upperBound(w);
  const rows = await queryAll<{ payload: string }>(
    `SELECT payload FROM sensing_events
     WHERE stream = 'app_usage_threshold' AND ts >= ? ${cap.sql}AND uid = ?`,
    [w.sinceTs, ...cap.params, getActiveUid()]
  );
  const highest: Record<string, number | null> = { social: null, audioVideo: null, total: null };
  // Per-app rows ride the same stream under category 'app'; they carry an appId and are kept apart
  // from the group buckets, which is why `category in highest` skips them here.
  const perApp = new Map<string, number>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as {
        category?: unknown;
        thresholdMinutes?: unknown;
        appId?: unknown;
      };
      const category = parsed?.category;
      const minutes = parsed?.thresholdMinutes;
      if (typeof minutes !== 'number' || !Number.isFinite(minutes)) continue;
      if (category === 'app') {
        if (typeof parsed.appId !== 'string' || parsed.appId === '') continue;
        const seen = perApp.get(parsed.appId);
        if (seen == null || minutes > seen) perApp.set(parsed.appId, minutes);
        continue;
      }
      if (typeof category !== 'string' || !(category in highest)) continue;
      const current = highest[category];
      if (current == null || minutes > current) highest[category] = minutes;
    } catch {
    }
  }

  const labels = perApp.size > 0 ? await appLabelsFor(getActiveUid()) : {};
  // Named apps first, then by time: an unnamed anonymous code is the least useful thing to lead with.
  const apps: AppUsage[] = [...perApp.entries()]
    .map(([appId, atLeastMinutes]) => ({ appId, name: labels[appId] ?? null, atLeastMinutes }))
    .sort((a, b) =>
      a.name != null && b.name == null
        ? -1
        : a.name == null && b.name != null
          ? 1
          : b.atLeastMinutes - a.atLeastMinutes
    );

  return {
    socialThresholdMin: highest.social,
    audioVideoThresholdMin: highest.audioVideo,
    totalThresholdMin: highest.total,
    apps,
  };
}

export function todayUsageDigest(): Promise<UsageDigest> {
  return usageDigestBetween(TODAY());
}

export function yesterdayUsageDigest(): Promise<UsageDigest> {
  return usageDigestBetween(YESTERDAY());
}

async function usageDigestBetween(w: DayWindow): Promise<UsageDigest> {
  const [screenRead, appOpens, categories, callSessionMs, thresholds] = await Promise.all([
    screenEventsBetween(w),
    appOpenCountBetween(w),
    categoryDurationsBetween(w),
    callSessionMsBetween(w),
    usageThresholdsBetween(w),
  ]);
  const { events } = screenRead;
  const { deriveScreenSessions, summarizeScreenSessions, countUnlocks } = await import(
    './screenSessions'
  );
  return {
    screen: events.length > 0 ? summarizeScreenSessions(deriveScreenSessions(events)) : null,
    unlocks: countUnlocks(events),
    appOpens,
    screenSource: screenRead.source,
    socialMs: categories.socialMs,
    audioVideoMs: categories.audioVideoMs,
    callMs: callSessionMs ?? categories.callMs,
    ...thresholds,
  };
}

export async function markUploaded(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { exec } = await db();
  for (const group of chunk(ids, 500)) {
    const placeholders = group.map(() => '?').join(', ');
    await exec(
      `UPDATE sensing_events SET uploaded = 1 WHERE id IN (${placeholders})`,
      group
    );
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('chunk: size must be a positive integer');
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

const META_KEYS = {
  lastUploadSuccessTs: 'last_upload_success_ts',
  lastUploadFailureTs: 'last_upload_failure_ts',
  lastUploadError: 'last_upload_error',
  consecutiveFailures: 'upload_consecutive_failures',
} as const;

async function ensureMetaTable(): Promise<void> {
  const { exec } = await db();
  await exec('CREATE TABLE IF NOT EXISTS sensing_meta (key TEXT PRIMARY KEY, value TEXT)');
}

export async function recordUploadSuccess(): Promise<void> {
  await ensureMetaTable();
  const { exec } = await db();
  await exec('INSERT OR REPLACE INTO sensing_meta (key, value) VALUES (?, ?)', [
    META_KEYS.lastUploadSuccessTs,
    String(Date.now()),
  ]);
  await exec('INSERT OR REPLACE INTO sensing_meta (key, value) VALUES (?, ?)', [
    META_KEYS.consecutiveFailures,
    '0',
  ]);
}

export async function recordUploadFailure(reason: string): Promise<void> {
  await ensureMetaTable();
  const { exec, queryAll } = await db();
  const rows = await queryAll<{ value: string }>(
    'SELECT value FROM sensing_meta WHERE key = ?',
    [META_KEYS.consecutiveFailures]
  );
  const next = (Number(rows[0]?.value ?? '0') || 0) + 1;
  await exec('INSERT OR REPLACE INTO sensing_meta (key, value) VALUES (?, ?)', [
    META_KEYS.lastUploadFailureTs,
    String(Date.now()),
  ]);
  await exec('INSERT OR REPLACE INTO sensing_meta (key, value) VALUES (?, ?)', [
    META_KEYS.lastUploadError,
    reason.slice(0, 500),
  ]);
  await exec('INSERT OR REPLACE INTO sensing_meta (key, value) VALUES (?, ?)', [
    META_KEYS.consecutiveFailures,
    String(next),
  ]);
}

const POLL_ANCHOR_PREFIX = 'poll_anchor_';

export const MAX_BACKFILL_MS = 7 * 24 * 60 * 60_000;

/** Wearables can sync hours late, so each poll re-reads this much overlap before its anchor. upsert()'s unchanged-payload guard keeps the overlap from re-uploading. */
export const LATE_ARRIVAL_MARGIN_MS = 24 * 60 * 60_000;

export async function getPollWindowStart(name: string, now: number = Date.now()): Promise<number> {
  await ensureMetaTable();
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ value: string }>(
    'SELECT value FROM sensing_meta WHERE key = ?',
    [`${POLL_ANCHOR_PREFIX}${getActiveUid()}_${name}`]
  );
  const anchor = Number(rows[0]?.value);
  const floor = now - MAX_BACKFILL_MS;
  if (!Number.isFinite(anchor) || anchor <= 0) return floor;
  return Math.max(anchor - LATE_ARRIVAL_MARGIN_MS, floor);
}

export async function setPollAnchor(name: string, ts: number): Promise<void> {
  await ensureMetaTable();
  const { exec } = await db();
  const { getActiveUid } = await firebaseSvc();
  await exec('INSERT OR REPLACE INTO sensing_meta (key, value) VALUES (?, ?)', [
    `${POLL_ANCHOR_PREFIX}${getActiveUid()}_${name}`,
    String(ts),
  ]);
}

export async function wearableDataPresence(): Promise<{ heartRate: boolean; sleep: boolean }> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const rows = await queryAll<{ stream: string; n: number }>(
    `SELECT stream, COUNT(*) AS n FROM sensing_events
     WHERE uid = ? AND stream IN ('health_heart_rate', 'sleep', 'sleep_night') GROUP BY stream`,
    [getActiveUid()]
  );
  const counts = new Map(rows.map((r) => [r.stream, r.n]));
  return {
    heartRate: (counts.get('health_heart_rate') ?? 0) > 0,
    sleep: (counts.get('sleep') ?? 0) > 0 || (counts.get('sleep_night') ?? 0) > 0,
  };
}

export interface UploadStatus {
  pending: number;
  lastSuccessTs: number | null;
  lastFailureTs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export async function getUploadStatus(): Promise<UploadStatus> {
  await ensureMetaTable();
  const { queryAll } = await db();
  const rows = await queryAll<{ key: string; value: string }>(
    'SELECT key, value FROM sensing_meta WHERE key IN (?, ?, ?, ?)',
    [
      META_KEYS.lastUploadSuccessTs,
      META_KEYS.lastUploadFailureTs,
      META_KEYS.lastUploadError,
      META_KEYS.consecutiveFailures,
    ]
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    pending: await pendingCount(),
    lastSuccessTs: map.has(META_KEYS.lastUploadSuccessTs)
      ? Number(map.get(META_KEYS.lastUploadSuccessTs))
      : null,
    lastFailureTs: map.has(META_KEYS.lastUploadFailureTs)
      ? Number(map.get(META_KEYS.lastUploadFailureTs))
      : null,
    lastError: map.get(META_KEYS.lastUploadError) ?? null,
    consecutiveFailures: Number(map.get(META_KEYS.consecutiveFailures) ?? '0'),
  };
}

export interface RawStreamRow {
  id: number;
  stream: string;
  ts: number;
  payload: string;
  uploaded: number;
  dedupeKey: string | null;
}

export async function rawStreamRows(
  streams: string[],
  limit = 100,
  offset = 0
): Promise<RawStreamRow[]> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const filter = streams.length > 0 ? `AND stream IN (${streams.map(() => '?').join(', ')})` : '';
  return queryAll<RawStreamRow>(
    `SELECT id, stream, ts, payload, uploaded, dedupe_key AS dedupeKey
       FROM sensing_events
      WHERE uid = ? ${filter}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?`,
    [getActiveUid(), ...streams, limit, offset]
  );
}

export interface StreamSummary {
  stream: string;
  total: number;
  today: number;
  pending: number;
  firstTs: number | null;
  lastTs: number | null;
}

export async function streamSummaries(streams: string[]): Promise<StreamSummary[]> {
  const { queryAll } = await db();
  const { getActiveUid } = await firebaseSvc();
  const filter = streams.length > 0 ? `AND stream IN (${streams.map(() => '?').join(', ')})` : '';
  const rows = await queryAll<StreamSummary>(
    `SELECT stream,
            COUNT(*) AS total,
            SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN uploaded = 0 THEN 1 ELSE 0 END) AS pending,
            MIN(ts) AS firstTs,
            MAX(ts) AS lastTs
       FROM sensing_events
      WHERE uid = ? ${filter}
      GROUP BY stream
      ORDER BY COUNT(*) DESC`,
    [startOfToday(), getActiveUid(), ...streams]
  );
  if (streams.length === 0) return rows;
  const found = new Map(rows.map((r) => [r.stream, r]));
  return streams.map(
    (stream) =>
      found.get(stream) ?? { stream, total: 0, today: 0, pending: 0, firstTs: null, lastTs: null }
  );
}
