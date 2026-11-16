/**
 * App-usage event logging: a local `app_events` queue with batch upload to Firestore, kept apart from the sensing tables so research sensor data and product analytics stay separate.
 * services/db is imported lazily inside each function so logEvent() and serializeProps() can run from plain Node (scripts/selfcheck-logging.ts).
 */
import { collection, doc, writeBatch } from 'firebase/firestore';
import { CONFIG } from '../config';
import { chunk } from '../modules/sensing/queue';
import { getDeviceId } from './deviceId';
import { ensureSignedIn, getActiveUid, getDb } from './firebase';
import type { AppEventRow } from './db';

type DbModule = typeof import('./db');

function db(): Promise<DbModule> {
  return import('./db');
}

export function serializeProps(props?: object): string {
  return JSON.stringify(props ?? {});
}

export async function logEvent(name: string, props?: object): Promise<void> {
  const { exec } = await db();
  await exec(
    'INSERT INTO app_events (event, props, ts, uploaded, uid) VALUES (?, ?, ?, 0, ?)',
    [name, serializeProps(props), Date.now(), getActiveUid()]
  );
}

export async function pendingCount(): Promise<number> {
  const { queryAll } = await db();
  const rows = await queryAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM app_events WHERE uploaded = 0 AND uid = ?',
    [getActiveUid()]
  );
  return rows[0]?.n ?? 0;
}

export async function markUploaded(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { exec } = await db();
  // Update in chunks to stay under SQLite's bind-variable limit.
  for (const group of chunk(ids, 500)) {
    const placeholders = group.map(() => '?').join(', ');
    await exec(
      `UPDATE app_events SET uploaded = 1 WHERE id IN (${placeholders})`,
      group
    );
  }
}

// In-flight guard: overlapping callers await the same upload instead of racing to upload the same unmarked rows.
let inFlight: Promise<{ uploaded: number }> | null = null;

// Safety cap on batches per flush() so a broken loop can't spin forever; not a realistic ceiling for a normal backlog.
const MAX_BATCHES_PER_FLUSH = 50;

export function flush(): Promise<{ uploaded: number }> {
  if (!inFlight) {
    inFlight = doFlush().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function doFlush(): Promise<{ uploaded: number }> {
  const remote = getDb();
  if (!remote) return { uploaded: 0 };

  let user;
  try {
    user = await ensureSignedIn();
  } catch (err) {
    console.warn('Log upload failed: could not sign in:', err);
    return { uploaded: 0 };
  }
  if (!user) return { uploaded: 0 };

  const { queryAll } = await db();

  let totalUploaded = 0;
  for (let batchNum = 0; batchNum < MAX_BATCHES_PER_FLUSH; batchNum++) {
    let rows: AppEventRow[];
    try {
      rows = await queryAll<AppEventRow>(
        'SELECT * FROM app_events WHERE uploaded = 0 AND uid = ? ORDER BY id ASC LIMIT ?',
        [getActiveUid(), CONFIG.LOGGING.uploadBatchSize]
      );
    } catch (err) {
      console.warn('Log upload failed: local query error:', err);
      break;
    }
    if (rows.length === 0) break;

    try {
      const deviceId = await getDeviceId();
      const events = collection(remote, 'logs', deviceId, 'events');

      const batch = writeBatch(remote);
      for (const row of rows) {
        let props: unknown;
        try {
          props = JSON.parse(row.props);
        } catch {
          props = { raw: row.props };
        }
        // Deterministic doc id (the row's local id), so a re-upload after a crash or overlapping flush overwrites the same document instead of creating a duplicate.
        batch.set(doc(events, String(row.id)), {
          event: row.event,
          props,
          ts: row.ts,
          uid: user.uid,
        });
      }
      await batch.commit();
      await markUploaded(rows.map((r) => r.id));
      totalUploaded += rows.length;
    } catch (err) {
      console.warn('Log upload failed: Firestore write error:', err);
      break;
    }

    if (rows.length < CONFIG.LOGGING.uploadBatchSize) break;
  }

  return { uploaded: totalUploaded };
}
