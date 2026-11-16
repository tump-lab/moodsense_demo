/**
 * Persisted Insights mood-trend chart range, stored in its own lazily created table (same pattern as companion_voice_settings and community_selection).
 * Separate from InsightsScreen's `reportPeriod`, which is a one-off AI report request, not a display preference.
 */
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';

export type TrendRange = 'week' | 'month' | 'year';

const DEFAULT_RANGE: TrendRange = 'week';
const VALID_RANGES: readonly TrendRange[] = ['week', 'month', 'year'];

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS insights_range_settings (
         uid TEXT PRIMARY KEY,
         range TEXT NOT NULL
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

export async function getTrendRange(): Promise<TrendRange> {
  try {
    await ensureTable();
    const rows = await queryAll<{ range: string }>(
      'SELECT range FROM insights_range_settings WHERE uid = ?',
      [getActiveUid()]
    );
    const saved = rows[0]?.range;
    return (VALID_RANGES as string[]).includes(saved ?? '')
      ? (saved as TrendRange)
      : DEFAULT_RANGE;
  } catch {
    // DB unavailable: fall back so the UI still works.
    return DEFAULT_RANGE;
  }
}

export async function setTrendRange(range: TrendRange): Promise<void> {
  try {
    await ensureTable();
    await exec(
      `INSERT INTO insights_range_settings (uid, range) VALUES (?, ?)
       ON CONFLICT(uid) DO UPDATE SET range = excluded.range`,
      [getActiveUid(), range]
    );
  } catch {
    // Not fatal; the in-memory selection still drives the chart for this session.
  }
}
