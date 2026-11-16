/**
 * Loads the Home trend card's inputs from local SQLite and caches the built series.
 *
 * Load order is cache-first: the last series built for this account is returned from memory or AsyncStorage at once,
 * and a rebuild only happens when the data fingerprint (today's date plus each source table's newest row id) moved.
 * A rebuild is a handful of indexed reads over HISTORY_DAYS and a sub-millisecond model fit.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryAll, type Mood } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { logEvent } from '../../services/logging';
import { PHYSICAL_STREAMS, assembleHistory } from './wellbeingTrendAggregate';
import {
  buildTrendSeries,
  dayKeysEnding,
  dayProgress,
  daySlot,
  localDateKey,
  type DayInputs,
  type TrendSeries,
} from './wellbeingTrend';

/** Days the model learns from. The card shows at most MAX_SHOW_DAYS of them. */
const HISTORY_DAYS = 60;
export const MAX_SHOW_DAYS = 30;

// 3: TrendPoint gained `basis`. A v2 entry deserialises into a point with no basis at all, which
// the card's hold-to-explain panel reads straight through, so the old key has to be abandoned
// rather than reused.
const CACHE_VERSION = 7;

const cacheKey = (uid: string) => `wellbeingTrend:v${CACHE_VERSION}:${uid}`;

interface CachedTrend {
  fingerprint: string;
  series: TrendSeries;
}

const memory = new Map<string, CachedTrend>();

/** Sub-millisecond clock where the runtime has one (Hermes and Node both do); Date.now() otherwise. */
function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

async function fingerprint(uid: string): Promise<string> {
  const rows = await queryAll<{ c: number | null; p: number | null; m: number | null; s: number | null }>(
    `SELECT
       (SELECT MAX(id) FROM checkins WHERE uid = ?) AS c,
       (SELECT MAX(id) FROM phq4_results WHERE uid = ?) AS p,
       (SELECT MAX(id) FROM chat_messages WHERE uid = ?) AS m,
       (SELECT MAX(id) FROM sensing_events WHERE uid = ?) AS s`,
    [uid, uid, uid, uid]
  );
  const r = rows[0];
  const now = new Date();
  // The slot is in here so the line still moves on a day when no new row happens to land: a
  // participant who leaves their phone on a desk all afternoon should still see today re-read in
  // the evening, rather than a morning reading frozen until midnight.
  return [
    localDateKey(now),
    daySlot(now),
    r?.c ?? 0,
    r?.p ?? 0,
    r?.m ?? 0,
    r?.s ?? 0,
  ].join('|');
}

async function loadHistory(uid: string): Promise<DayInputs[]> {
  const now = new Date();
  const dates = dayKeysEnding(now, HISTORY_DAYS);
  const sinceTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (HISTORY_DAYS - 1)).getTime();
  const firstDate = dates[0]!;

  const placeholders = PHYSICAL_STREAMS.map(() => '?').join(', ');
  const [checkins, phq4, chats, sensing, unlockRows] = await Promise.all([
    queryAll<{ date: string; mood: Mood }>(
      'SELECT date, mood FROM checkins WHERE uid = ? AND date >= ?',
      [uid, firstDate]
    ),
    queryAll<{ ts: number; total: number }>(
      'SELECT ts, total FROM phq4_results WHERE uid = ? AND ts >= ? ORDER BY ts ASC',
      [uid, sinceTs]
    ),
    queryAll<{ ts: number; content: string | null; transcript: string | null }>(
      `SELECT ts, content, transcript FROM chat_messages WHERE uid = ? AND role = 'user' AND ts >= ?`,
      [uid, sinceTs]
    ),
    queryAll<{ stream: string; ts: number; payload: string }>(
      `SELECT stream, ts, payload FROM sensing_events
       WHERE uid = ? AND ts >= ? AND stream IN (${placeholders})`,
      [uid, sinceTs - 86_400_000, ...PHYSICAL_STREAMS]
    ),
    // Only OS-level screen sources see real unlocks; MoodSense's own AppState rows would read as pick-ups otherwise.
    queryAll<{ ts: number }>(
      `SELECT ts FROM sensing_events
       WHERE uid = ? AND stream = 'screen' AND ts >= ?
         AND payload LIKE '%"type":"screen_unlock"%'
         AND (payload LIKE '%"source":"usage_events"%' OR payload LIKE '%"source":"ios_protected_data"%')`,
      [uid, sinceTs]
    ),
  ]);

  return assembleHistory(dates, { checkins, phq4, chats, sensing, unlockRows });
}

/** Whatever was last built for this account, without touching SQLite. Null on a first-ever open. */
export async function readCachedTrend(): Promise<TrendSeries | null> {
  const uid = getActiveUid();
  const hit = memory.get(uid);
  if (hit) return hit.series;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTrend;
    memory.set(uid, parsed);
    return parsed.series;
  } catch {
    return null;
  }
}

/** Rebuilds only when something the card depends on changed since the cached build; otherwise returns the cache. */
export async function refreshTrend(): Promise<TrendSeries> {
  const uid = getActiveUid();
  const fp = await fingerprint(uid);
  const cached = memory.get(uid) ?? null;
  if (cached && cached.fingerprint === fp) return cached.series;

  // Today's passive signals are a part-day total, and the model is told so rather than left to read
  // a morning as a sedentary day.
  const history = await loadHistory(uid);
  const started = nowMs();
  const series = buildTrendSeries(history, MAX_SHOW_DAYS, {
    todayProgress: dayProgress(),
  });
  // The fit's own cost on this phone, kept apart from the SQLite reads above. The only number for
  // "how long does the model take on a device" that the project has; scripts/bench-wellbeing-trend.ts
  // gives the laptop equivalent.
  void logEvent('wellbeing_trend_rebuilt', {
    buildMs: Math.round((nowMs() - started) * 1000) / 1000,
    historyDays: history.length,
    learnedFromDays: series.learnedFromDays,
  });
  const entry: CachedTrend = { fingerprint: fp, series };
  memory.set(uid, entry);
  AsyncStorage.setItem(cacheKey(uid), JSON.stringify(entry)).catch(() => {});
  return series;
}
