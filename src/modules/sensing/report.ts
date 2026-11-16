/**
 * Builds the daily/weekly insights report from local SQLite, via the LLM when the account has opted into AI and via the on-device buildDemoReport otherwise.
 * Not persisted; re-opening the screen re-generates it.
 */
import { Platform } from 'react-native';
import { queryAll, type Mood } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { chatComplete, LlmError } from '../../services/llm';
import { logEvent } from '../../services/logging';
import {
  latestSleepNight,
  latestSleepNightEstimate,
  startOfToday,
  screenSourceSeesGlances,
  todayUsageDigest,
} from './queue';
import { isAiLive } from '../../services/aiGateway';
import {
  buildDemoReport,
  buildReportPrompt,
  toProse,
  type ReportCommunity,
  type ReportData,
  type ReportGrowth,
  type ReportMoodEntry,
  type ReportPeriod,
  type ReportPhq4,
  type ReportUsage,
} from './reportPrompt';
import { dayKeysEnding } from '../checkin/wellbeingTrend';
import { computeStreak } from '../checkin/streak';
import {
  LEVEL_WINDOW_DAYS,
  MAX_LEVEL,
  computeLevelStats,
  tierForPoints,
  type LevelEntry,
} from '../rewards/level';
import { getNearbyMoods } from '../community/aggregate';
import { getChosenCommunity } from '../community/store';

export type { ReportPeriod } from './reportPrompt';

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function severityWord(total: number): string {
  if (total <= 2) return 'None';
  if (total <= 5) return 'Mild';
  if (total <= 8) return 'Moderate';
  return 'Severe';
}

async function loadMoodEntries(days: number): Promise<ReportMoodEntry[]> {
  const now = Date.now();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(localDateStr(new Date(now - i * DAY_MS)));
  }
  const first = dates[0] ?? '';
  const rows = await queryAll<{ date: string; mood: Mood; note: string | null }>(
    'SELECT date, mood, note FROM checkins WHERE date >= ? AND uid = ? ORDER BY ts ASC',
    [first, getActiveUid()]
  );
  const byDate = new Map<string, { mood: Mood; note: string | null }>();
  for (const r of rows) byDate.set(r.date, r);
  return dates.map((date) => {
    const row = byDate.get(date);
    return { date, mood: row ? row.mood : null, note: row?.note ?? null };
  });
}

async function loadPhq4Since(sinceTs: number): Promise<ReportPhq4 | null> {
  const rows = await queryAll<{ total: number }>(
    'SELECT total FROM phq4_results WHERE uid = ? AND ts >= ? ORDER BY ts DESC LIMIT 1',
    [getActiveUid(), sinceTs]
  );
  const latest = rows[0];
  if (!latest) return null;
  return { total: latest.total, severity: severityWord(latest.total) };
}

/**
 * Steps are logged as a running total since local midnight, polled through the day.
 * Take each day's max reading and add those, so repeated polls are not double-counted.
 */
async function loadStepsSince(sinceTs: number): Promise<number | null> {
  const rows = await queryAll<{ payload: string; ts: number }>(
    `SELECT payload, ts FROM sensing_events
     WHERE stream = 'steps' AND ts >= ? AND uid = ? ORDER BY ts ASC`,
    [sinceTs, getActiveUid()]
  );
  if (rows.length === 0) return null;
  const maxByDay = new Map<string, number>();
  for (const row of rows) {
    let count: number | null = null;
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { count?: unknown }).count === 'number'
      ) {
        count = (parsed as { count: number }).count;
      }
    } catch {
    }
    if (count == null) continue;
    const day = localDateStr(new Date(row.ts));
    const prev = maxByDay.get(day);
    if (prev == null || count > prev) maxByDay.set(day, count);
  }
  if (maxByDay.size === 0) return null;
  let total = 0;
  for (const v of maxByDay.values()) total += v;
  return total;
}

/**
 * The second count is MoodSense's own opens, not phone unlocks: only the AppState proxy writes
 * `source: 'app_state'`, and a real unlock is a different row entirely. Counting every
 * `state: "active"` row as an unlock — which this did — silently summed the two together.
 */
async function loadScreenStats(
  sinceTs: number
): Promise<{ screenEvents: number; appOpens: number }> {
  const uid = getActiveUid();
  const [screenRows, appOpenRows] = await Promise.all([
    queryAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sensing_events WHERE stream = 'screen' AND ts >= ? AND uid = ?`,
      [sinceTs, uid]
    ),
    queryAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sensing_events
       WHERE stream = 'screen' AND ts >= ? AND payload LIKE '%"state":"active"%'
         AND payload LIKE '%"source":"app_state"%' AND uid = ?`,
      [sinceTs, uid]
    ),
  ]);
  return { screenEvents: screenRows[0]?.n ?? 0, appOpens: appOpenRows[0]?.n ?? 0 };
}

/**
 * Deliberately today's numbers even for the weekly report, since the digest is today-scoped and there are no per-day rollups yet.
 * The prompt lines say so.
 */
async function loadUsage(): Promise<ReportUsage> {
  const [digest, sleep, sleepEstimate] = await Promise.all([
    todayUsageDigest(),
    latestSleepNight(),
    latestSleepNightEstimate(),
  ]);
  const night = sleep ?? sleepEstimate;
  return {
    sleepOnsetTs: night?.onsetTs ?? null,
    sleepWakeTs: night?.wakeTs ?? null,
    sleepEstimated: sleep == null && sleepEstimate != null,
    unlockCount: digest.unlocks,
    appOpenCount: digest.appOpens,
    // Withheld, not zeroed, where a 15-second session is an artefact of the source rather than a glance.
    glanceCount: screenSourceSeesGlances(digest.screenSource)
      ? digest.screen?.glanceCount ?? null
      : null,
    longestScreenMs: digest.screen?.longestMs ?? null,
    socialMs: digest.socialMs,
    audioVideoMs: digest.audioVideoMs,
    callMs: digest.callMs,
    // Android infers call time from dialer foreground time; iOS gets it from CallKit.
    // Only one platform produces call rows on a device, so the platform is the discriminator.
    callEstimated: Platform.OS !== 'ios',
    namedApps: digest.apps
      .filter((a): a is typeof a & { name: string } => a.name != null)
      .map((a) => ({ name: a.name, atLeastMinutes: a.atLeastMinutes })),
    socialThresholdMin: digest.socialThresholdMin,
    audioVideoThresholdMin: digest.audioVideoThresholdMin,
  };
}

/**
 * The level their tree is at, read over the same window the You tab's card uses so the report and
 * the card never disagree. Null on any failure: the report is still worth writing without it.
 */
async function loadGrowth(): Promise<ReportGrowth | null> {
  try {
    const window = dayKeysEnding(new Date(), LEVEL_WINDOW_DAYS);
    const rows = await queryAll<{ date: string; mood: Mood }>(
      'SELECT date, mood FROM checkins WHERE uid = ? AND date >= ? ORDER BY date ASC',
      [getActiveUid(), window[0]!]
    );
    const entries: LevelEntry[] = rows
      .filter((r) => r.date != null && r.mood != null)
      .map((r) => ({ date: r.date, mood: r.mood }));
    const streak = computeStreak(
      entries.map((e) => e.date),
      window[window.length - 1]!
    );
    const stats = computeLevelStats(entries, window, streak);
    const tier = tierForPoints(stats.points);
    return {
      level: tier.level,
      maxLevel: MAX_LEVEL,
      name: tier.name,
      checkinDays: stats.daysLogged,
    };
  } catch {
    return null;
  }
}

/**
 * The anonymous community aggregate, as the one "you are not the only one" fact the report may use.
 * Null without a chosen community, and null when the buckets are empty (no data yet), which
 * must not read as "nobody felt low".
 */
async function loadCommunity(): Promise<ReportCommunity | null> {
  try {
    const communityId = await getChosenCommunity();
    if (!communityId) return null;
    const buckets = await getNearbyMoods(communityId);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    if (total === 0) return null;
    const heavier = buckets
      .filter((b) => b.label === 'Stressed' || b.label === 'Low')
      .reduce((sum, b) => sum + b.count, 0);
    return { label: communityId, heavierShare: heavier / total };
  } catch {
    return null;
  }
}

export async function gatherReportData(period: ReportPeriod): Promise<ReportData> {
  const days = period === 'daily' ? 1 : 7;
  const sinceTs = startOfToday() - (days - 1) * DAY_MS;
  const [moodEntries, phq4, steps, screen, usage, growth, community] = await Promise.all([
    loadMoodEntries(days),
    loadPhq4Since(sinceTs),
    loadStepsSince(sinceTs),
    loadScreenStats(sinceTs),
    loadUsage(),
    loadGrowth(),
    loadCommunity(),
  ]);
  return {
    period,
    moodEntries,
    phq4,
    steps,
    screenEvents: screen.screenEvents,
    appOpens: screen.appOpens,
    usage,
    growth,
    community,
  };
}

/**
 * Both halves are logged on failure so a local-data error is not mistaken for an LLM one.
 * The error is re-thrown unwrapped so callers can read LlmError's `kind`/`retryAfterMs`.
 */
export async function generateReport(period: ReportPeriod): Promise<string> {
  let data: ReportData;
  try {
    data = await gatherReportData(period);
  } catch (err) {
    console.warn('AI report failed while gathering local data:', err);
    void logEvent('ai_report_failed', {
      period,
      stage: 'gather',
      reason: err instanceof Error ? err.message : 'unknown_error',
    });
    throw err;
  }

  if (!isAiLive('chat')) {
    void logEvent('ai_report_demo', { period });
    return toProse(buildDemoReport(data));
  }

  const messages = buildReportPrompt(data);
  try {
    const text = await chatComplete(messages);
    void logEvent('ai_report_generated', { period });
    return toProse(text);
  } catch (err) {
    console.warn('AI report failed at the LLM call:', err);
    void logEvent('ai_report_failed', {
      period,
      stage: 'llm',
      kind: err instanceof LlmError ? err.kind : 'unknown',
      status: err instanceof LlmError ? err.status : undefined,
      reason: err instanceof Error ? err.message : 'unknown_error',
    });
    throw err;
  }
}
