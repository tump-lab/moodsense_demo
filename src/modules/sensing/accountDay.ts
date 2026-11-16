/**
 * Reads one completed local day across every device on the account, using the rows
 * uploader.ts mirrors to Firestore. Only yesterday reads through here; today's rows are
 * still in flight, so they stay on the local readers.
 */
import {
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { APP_STEPS_STREAM, startOfToday, startOfYesterday } from './queue';

export interface AccountDayRow {
  stream: string;
  ts: number;
  payload: unknown;
  deviceId: string;
  /**
   * The Firestore document id, which is the row id it had on the device that wrote it. Optional so
   * that a hand-built row in a test does not have to invent one; cloudBackfill.ts falls back to the
   * timestamp, which is just as unique within one device and stream.
   */
  docId?: string;
}

export interface AccountDayStats {
  steps: number | null;
  appSteps: number | null;
  screenEvents: number;
  /** Phone pick-ups. Null when no device that day ran a collector that can see unlocks at all. */
  unlocks: number | null;
  /** Times MoodSense was opened, which is a different event from the phone being picked up. */
  appOpens: number;
  screenTimeMs: number | null;
}

function byStreamDesc(rows: AccountDayRow[], stream: string): AccountDayRow[] {
  return rows.filter((r) => r.stream === stream).sort((a, b) => b.ts - a.ts);
}

/**
 * Summing is right for discrete events (two devices' screen events are two events) and
 * wrong for daily totals; see latestNumber.
 */
export function countStream(rows: AccountDayRow[], stream: string): number {
  return rows.reduce((n, r) => (r.stream === stream ? n + 1 : n), 0);
}

/** The collectors that can see the phone itself being unlocked, as opposed to MoodSense being opened. */
const OS_SCREEN_SOURCES: ReadonlySet<unknown> = new Set(['usage_events', 'ios_protected_data']);

function screenRowSource(row: AccountDayRow): unknown {
  return (row.payload as { source?: unknown } | null)?.source;
}

/**
 * Real device unlocks, and null rather than 0 when nothing that day came from a source that can see
 * them — a device whose only screen rows are AppState proxy rows has no opinion about unlocks, and
 * reporting that as zero would read as "never touched the phone".
 */
export function countUnlockRows(rows: AccountDayRow[]): number | null {
  let sawUnlockCapableSource = false;
  let unlocks = 0;
  for (const r of rows) {
    if (r.stream !== 'screen' || !OS_SCREEN_SOURCES.has(screenRowSource(r))) continue;
    sawUnlockCapableSource = true;
    if ((r.payload as { type?: unknown } | null)?.type === 'screen_unlock') unlocks += 1;
  }
  return sawUnlockCapableSource ? unlocks : null;
}

export function countAppOpenRows(rows: AccountDayRow[]): number {
  return rows.reduce(
    (n, r) =>
      r.stream === 'screen' &&
      screenRowSource(r) === 'app_state' &&
      (r.payload as { state?: unknown } | null)?.state === 'active'
        ? n + 1
        : n,
    0
  );
}

/**
 * Latest row wins, never a sum: both streams carry a running day total, so adding two
 * devices' rows would double-count the day.
 */
export function latestNumber(
  rows: AccountDayRow[],
  stream: string,
  field: string
): number | null {
  for (const row of byStreamDesc(rows, stream)) {
    const v = (row.payload as Record<string, unknown> | null)?.[field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function summarizeDay(rows: AccountDayRow[]): AccountDayStats {
  return {
    steps: latestNumber(rows, 'steps', 'count'),
    appSteps: latestNumber(rows, APP_STEPS_STREAM, 'count'),
    screenEvents: countStream(rows, 'screen'),
    unlocks: countUnlockRows(rows),
    appOpens: countAppOpenRows(rows),
    screenTimeMs: latestNumber(rows, 'app_usage', 'totalForegroundTimeMs'),
  };
}

/** Documents per Firestore read. Small enough that parsing one page never holds the JS thread for long. */
const PAGE_SIZE = 500;

/**
 * The path filter is required: logs/{deviceId}/events shares the collection name
 * 'events' with sensing/{deviceId}/events, so a collection group query matches both.
 *
 * Read in pages ordered by ts, yielding to the event loop between pages. A single unbounded
 * read of weeks of an account's rows is tens of thousands of documents, and the Firestore JS SDK
 * processes a snapshot that size synchronously enough to freeze every touch in the app.
 * `onPage`, when given, receives each page as it arrives instead of the rows being collected.
 */
export async function fetchDayRows(
  sinceTs: number,
  untilTs: number,
  onPage?: (rows: AccountDayRow[]) => Promise<void>
): Promise<AccountDayRow[] | null> {
  const { ensureSignedIn, getDb } = await import('../../services/firebase');
  const remote = getDb();
  if (!remote) return null;

  let user;
  try {
    user = await ensureSignedIn();
  } catch {
    return null;
  }
  if (!user) return null;

  try {
    const out: AccountDayRow[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
      const constraints: QueryConstraint[] = [
        where('uid', '==', user.uid),
        where('ts', '>=', sinceTs),
        where('ts', '<', untilTs),
        orderBy('ts'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(PAGE_SIZE),
      ];
      const snap: QuerySnapshot = await getDocs(query(collectionGroup(remote, 'events'), ...constraints));
      const page: AccountDayRow[] = [];
      for (const d of snap.docs) {
        const deviceDoc = d.ref.parent.parent;
        if (deviceDoc?.parent.id !== 'sensing') continue;
        const data = d.data() as { stream?: unknown; ts?: unknown; payload?: unknown };
        if (typeof data.stream !== 'string' || typeof data.ts !== 'number') continue;
        page.push({
          stream: data.stream,
          ts: data.ts,
          payload: data.payload,
          deviceId: deviceDoc.id,
          docId: d.id,
        });
      }
      if (onPage) await onPage(page);
      else out.push(...page);
      if (snap.docs.length < PAGE_SIZE) break;
      cursor = snap.docs[snap.docs.length - 1]!;
      // Let taps and renders through before the next page.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return out;
  } catch (err) {
    // Most likely the composite index has not finished building, or the device is
    // offline; the caller falls back to this device's local rows.
    console.warn('Account-wide day read failed:', err);
    return null;
  }
}

export async function accountYesterdayStats(): Promise<AccountDayStats | null> {
  const rows = await fetchDayRows(startOfYesterday(), startOfToday());
  return rows == null ? null : summarizeDay(rows);
}

export async function yesterdayStats(): Promise<{
  stats: AccountDayStats;
  scope: 'account' | 'device';
}> {
  const account = await accountYesterdayStats();
  if (account) return { stats: account, scope: 'account' };

  const {
    latestYesterdayAppSteps,
    latestYesterdaySteps,
    yesterdayCountByStream,
    yesterdayScreenTimeMs,
    yesterdayAppOpenCount,
    yesterdayUsageDigest,
  } = await import('./queue');
  const [steps, appSteps, byStream, appOpens, digest, screenTimeMs] = await Promise.all([
    latestYesterdaySteps(),
    latestYesterdayAppSteps(),
    yesterdayCountByStream(),
    yesterdayAppOpenCount(),
    yesterdayUsageDigest(),
    yesterdayScreenTimeMs(),
  ]);
  return {
    stats: {
      steps,
      appSteps,
      screenEvents: byStream['screen'] ?? 0,
      unlocks: digest.unlocks,
      appOpens,
      screenTimeMs,
    },
    scope: 'device',
  };
}
