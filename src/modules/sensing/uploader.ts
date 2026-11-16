import { collection, doc, writeBatch } from 'firebase/firestore';
import { CONFIG } from '../../config';
import { queryAll, type SensingEventRow } from '../../services/db';
import { getDeviceId } from '../../services/deviceId';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';
import { markUploaded, recordUploadFailure, recordUploadSuccess } from './queue';

let inFlight: Promise<{ uploaded: number }> | null = null;

const MAX_BATCHES_PER_FLUSH = 50;

/**
 * Uploads pending rows in batches until the backlog is drained; overlapping callers share the
 * upload already running. On any failure rows stay local with uploaded=0.
 */
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
    console.warn('Sensing upload failed: could not sign in:', err);
    await recordUploadFailure(`sign-in: ${err instanceof Error ? err.message : String(err)}`);
    return { uploaded: 0 };
  }
  if (!user) return { uploaded: 0 };

  let totalUploaded = 0;
  let failed = false;
  for (let batchNum = 0; batchNum < MAX_BATCHES_PER_FLUSH; batchNum++) {
    let rows: SensingEventRow[];
    try {
      rows = await queryAll<SensingEventRow>(
        'SELECT * FROM sensing_events WHERE uploaded = 0 AND uid = ? ORDER BY id ASC LIMIT ?',
        [getActiveUid(), CONFIG.SENSING.uploadBatchSize]
      );
    } catch (err) {
      console.warn('Sensing upload failed: local query error:', err);
      await recordUploadFailure(`local query: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
      break;
    }
    if (rows.length === 0) break;

    try {
      const deviceId = await getDeviceId();
      const events = collection(remote, 'sensing', deviceId, 'events');

      const batch = writeBatch(remote);
      for (const row of rows) {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload);
        } catch {
          payload = { raw: row.payload };
        }
        // Use the local row id as the doc id, so a re-upload overwrites instead of duplicating.
        batch.set(doc(events, String(row.id)), {
          stream: row.stream,
          ts: row.ts,
          payload,
          uid: user.uid,
        });
      }
      await batch.commit();
      await markUploaded(rows.map((r) => r.id));
      totalUploaded += rows.length;
    } catch (err) {
      console.warn('Sensing upload failed: Firestore write error:', err);
      await recordUploadFailure(`firestore write: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
      break;
    }

    if (rows.length < CONFIG.SENSING.uploadBatchSize) break;
  }

  // Record success even when nothing was pending: it tells the upload-status UI an idle device
  // is healthy, not stalled.
  if (!failed) await recordUploadSuccess();

  return { uploaded: totalUploaded };
}

// Long enough for a burst of writes (like the first-run health backfill) to finish before
// the SELECT runs, so it ships in one flush.
const FLUSH_DEBOUNCE_MS = 3_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Flushes shortly after a burst of writes settles. The scheduled triggers run on their own
 * clock, so without this, rows written just after a flush sit local for the whole interval.
 */
export function scheduleFlush(): void {
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}
