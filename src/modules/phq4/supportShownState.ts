/**
 * Remembers when the 988 card was last shown, per account, so the cooldown in supportResources.ts
 * survives a relaunch.
 *
 * Local only, with no Firestore mirror, for the same reason as checkin/supportPromptState.ts: a
 * participant who signs in on a second device can meet the card once more there, which is the
 * mistake worth making over a missed offer of help, and it keeps this off the upload path.
 */
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS phq4_support_state (
         uid TEXT PRIMARY KEY,
         last_shown_at INTEGER NOT NULL
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

/**
 * Epoch ms the card was last shown, or null if it never has been.
 *
 * A read failure reports "just shown", which holds a moderate card back for now. Without the row
 * there is no way to tell a first offer from a tenth, and the loud failure here is the card
 * reappearing on every check.
 */
export async function lastSupportShownAt(): Promise<number | null> {
  try {
    await ensureTable();
    const rows = await queryAll<{ last_shown_at: number }>(
      'SELECT last_shown_at FROM phq4_support_state WHERE uid = ?',
      [getActiveUid()]
    );
    return rows[0]?.last_shown_at ?? null;
  } catch {
    return Date.now();
  }
}

export async function markSupportShown(at: number = Date.now()): Promise<void> {
  try {
    await ensureTable();
    await exec(
      `INSERT INTO phq4_support_state (uid, last_shown_at) VALUES (?, ?)
       ON CONFLICT(uid) DO UPDATE SET last_shown_at = excluded.last_shown_at`,
      [getActiveUid(), at]
    );
  } catch {
    // The card was shown anyway; the next check re-reads whatever did get stored.
  }
}
