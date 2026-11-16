/**
 * Pulls the account's own uploaded sensing rows back into local SQLite.
 *
 * Every other stream already follows the account rather than the install — check-ins, Mood Checks,
 * consent, community and chat all have a sync like this one. `sensing_events` did not, and it is
 * the one table an iOS reinstall is guaranteed to destroy: the data container goes with the app,
 * and because a locally-signed build and a TestFlight build cannot replace each other in place,
 * the installer deletes it. What came back afterwards was a Home trend card whose mood dots had
 * returned from the cloud while every passive row under them read "not recorded", for days the
 * phone had in fact measured and uploaded.
 *
 * Rows written by *this* install are skipped: they are already here, and re-inserting them under a
 * second key would double-count the streams that are counted rather than totalled (unlocks, above
 * all). Everything else is keyed on where it came from, so running this repeatedly is safe.
 *
 * It is not free, though: the account's sensing rows run to tens of thousands of documents over
 * the trend window. So after the first full pass, each run only reads from just before where the
 * last successful one stopped, and the read itself arrives in pages (see fetchDayRows).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { exec } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { getDeviceId } from '../../services/deviceId';
import { fetchDayRows } from './accountDay';

/** How far back a backfill reaches: the trend card's own window. */
export const BACKFILL_DAYS = 60;

/**
 * Re-read this far before the last successful run's end, for rows another device recorded
 * earlier but only uploaded since (an offline phone catching up).
 */
const OVERLAP_MS = 2 * 86_400_000;

/** Home asks on every focus; within this long of a finished run the answer cannot have moved much. */
const MIN_INTERVAL_MS = 10 * 60_000;

const watermarkKey = (uid: string) => `cloudBackfill:until:${uid}`;
const lastRunAt = new Map<string, number>();

export interface BackfillResult {
  /** Rows fetched from the account's other installs. */
  fetched: number;
  /** Rows that were new here. */
  inserted: number;
}

let running: Promise<BackfillResult | null> | null = null;

/**
 * Best-effort, and null whenever it could not run — Firebase off, signed out, offline, or the
 * collection-group index still building (fetchDayRows logs that case). Callers treat null as "no
 * change" rather than as an error: the local rows are still whatever they were.
 *
 * Overlapping callers share one run, since Home and Settings can both ask on the same launch.
 */
export function backfillSensingFromCloud(days: number = BACKFILL_DAYS): Promise<BackfillResult | null> {
  if (!running) {
    running = doBackfill(days).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doBackfill(days: number): Promise<BackfillResult | null> {
  const uid = getActiveUid();
  if (uid === 'local') return null;
  if (Date.now() - (lastRunAt.get(uid) ?? 0) < MIN_INTERVAL_MS) return { fetched: 0, inserted: 0 };

  let thisDevice: string;
  try {
    thisDevice = await getDeviceId();
  } catch {
    return null;
  }

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const watermark = Number(await AsyncStorage.getItem(watermarkKey(uid)).catch(() => null));
  const since = Number.isFinite(watermark) && watermark > 0 ? Math.max(windowStart, watermark - OVERLAP_MS) : windowStart;
  const until = Date.now();

  let fetched = 0;
  let inserted = 0;
  const rows = await fetchDayRows(since, until, async (page) => {
    fetched += page.length;
    for (const row of page) {
      if (row.deviceId === thisDevice) continue;
      // Keyed on the row's origin, so a second run is a no-op and two devices that happen to have
      // used the same local row id do not collide.
      const dedupeKey = `cloud:${row.deviceId}:${row.docId ?? row.ts}`;
      try {
        const res = await exec(
          `INSERT INTO sensing_events (stream, ts, payload, uploaded, uid, dedupe_key)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(uid, stream, dedupe_key) DO NOTHING`,
          [row.stream, row.ts, JSON.stringify(row.payload ?? null), uid, dedupeKey]
        );
        inserted += res.changes;
      } catch {
        // One bad row must not cost the rest of the backfill.
      }
    }
  });
  if (rows == null) return null;

  lastRunAt.set(uid, Date.now());
  await AsyncStorage.setItem(watermarkKey(uid), String(until)).catch(() => {});
  return { fetched, inserted };
}
