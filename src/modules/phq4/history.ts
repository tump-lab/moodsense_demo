import { create } from 'zustand';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { exec, queryAll, type Phq4ResultRow } from '../../services/db';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';

/**
 * Bumped by Phq4Screen right after a result is saved so HomeScreen refreshes at once.
 * Navigation focus does not reliably re-fire on web when returning from the Phq4 modal.
 */
interface Phq4CompletionSignal {
  lastCompletedAt: number;
  markCompleted: () => void;
}
export const usePhq4CompletionSignal = create<Phq4CompletionSignal>((set) => ({
  lastCompletedAt: 0,
  markCompleted: () => set({ lastCompletedAt: Date.now() }),
}));

export async function getLatestResult(): Promise<Phq4ResultRow | null> {
  const rows = await queryAll<Phq4ResultRow>(
    'SELECT * FROM phq4_results WHERE uid = ? ORDER BY ts DESC LIMIT 1',
    [getActiveUid()]
  );
  return rows[0] ?? null;
}

/**
 * How many results strictly *before* `beforeTs`, but no older than `days`, scored at least
 * `minTotal`. Used by save.ts to tell a one-off moderate check apart from a pattern, so the row
 * just written has to be excluded by ts rather than counted as its own corroboration.
 *
 * Fails closed at 0: without the history there is nothing corroborating the current score, and the
 * quieter answer is the right one to be wrong with (supportResources.ts).
 */
export async function countElevatedResultsBefore(
  beforeTs: number,
  days: number,
  minTotal: number
): Promise<number> {
  const cutoff = beforeTs - days * 24 * 60 * 60 * 1000;
  try {
    const rows = await queryAll<{ c: number }>(
      'SELECT COUNT(*) AS c FROM phq4_results WHERE uid = ? AND ts < ? AND ts >= ? AND total >= ?',
      [getActiveUid(), beforeTs, cutoff, minTotal]
    );
    return rows[0]?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function hasResultInLastDays(days: number): Promise<boolean> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = await queryAll<{ c: number }>(
    'SELECT COUNT(*) AS c FROM phq4_results WHERE ts >= ? AND uid = ?',
    [cutoff, getActiveUid()]
  );
  return (rows[0]?.c ?? 0) > 0;
}

/**
 * Scoped to the local calendar day, not a rolling 24h window, so "done" clears at midnight instead of drifting.
 */
export async function hasResultToday(): Promise<boolean> {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const rows = await queryAll<{ c: number }>(
    'SELECT COUNT(*) AS c FROM phq4_results WHERE ts >= ? AND uid = ?',
    [midnight, getActiveUid()]
  );
  return (rows[0]?.c ?? 0) > 0;
}

/**
 * Pulls the account's Firestore-mirrored results into local SQLite, so a fresh device knows PHQ-4 was already done elsewhere.
 * No-op when Firebase is off or the session is not a real linked account.
 */
export async function syncPhq4FromCloud(): Promise<void> {
  const db = getDb();
  const uid = getActiveUid();
  if (!db || uid === 'local') return;
  try {
    const user = await ensureSignedIn();
    if (!user || user.uid !== uid) return;

    const snap = await getDocs(
      query(collection(db, 'users', uid, 'phq4_results'), orderBy('ts', 'desc'), limit(50))
    );
    if (snap.empty) return;

    const existing = await queryAll<{ ts: number }>(
      'SELECT ts FROM phq4_results WHERE uid = ?',
      [uid]
    );
    const knownTs = new Set(existing.map((r) => r.ts));

    for (const doc of snap.docs) {
      const d = doc.data() as {
        ts: number;
        q1: number;
        q2: number;
        q3: number;
        q4: number;
        total: number;
        anxiety: number;
        depression: number;
      };
      if (knownTs.has(d.ts)) continue;
      await exec(
        `INSERT INTO phq4_results (ts, q1, q2, q3, q4, total, anxiety, depression, uid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.ts, d.q1, d.q2, d.q3, d.q4, d.total, d.anxiety, d.depression, uid]
      );
    }
  } catch {
    // Best-effort; local state stays as it was.
  }
}
