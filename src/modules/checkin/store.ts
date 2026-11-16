/**
 * Check-in state: a zustand store backed by the local SQLite `checkins` table, with a fire-and-forget Firestore mirror when Firebase is enabled.
 */
import { create } from 'zustand';
import { collection, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import {
  exec,
  legacyMoodToLabel,
  queryAll,
  type CheckinRow,
  type EntrySource,
  type Mood,
} from '../../services/db';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';
import { computeStreak } from './streak';

export type { Mood } from '../../services/db';

export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface CheckinState {
  todayEntries: CheckinRow[];
  streak: number;
  history: CheckinRow[];
  load: () => Promise<void>;
  /** Drops the in-memory rows when the account changes, so the next account never renders the last one's history. */
  reset: () => void;
  /** `source` records the surface: the mood tiles on Home, or a draft confirmed in the companion chat. Resolves to the new row's ts. */
  logMood: (mood: Mood, source?: EntrySource) => Promise<number>;
  /** Attaches the reason sheet's answer to the check-in logged at `ts`. */
  setReasons: (ts: number, reasons: string[], note: string | null) => Promise<void>;
}

function derive(history: CheckinRow[]): Pick<CheckinState, 'history' | 'todayEntries' | 'streak'> {
  const today = todayLocalDate();
  return {
    history,
    todayEntries: history.filter((r) => r.date === today),
    streak: computeStreak(
      history.map((r) => r.date),
      today
    ),
  };
}

export const useCheckinStore = create<CheckinState>((set) => ({
  todayEntries: [],
  streak: 0,
  history: [],

  reset: () => set({ todayEntries: [], streak: 0, history: [] }),

  load: async () => {
    await syncCheckinsFromCloud();
    set(derive(await readHistory()));
  },

  logMood: async (mood: Mood, source: EntrySource = 'manual') => {
    const today = todayLocalDate();
    const ts = Date.now();
    const uid = getActiveUid();

    // Optimistic: the row is applied to state first so a tap shows on the same frame, and the durable write happens behind it.
    // `id` is a placeholder; the reload below replaces this row with the stored one.
    const optimistic: CheckinRow = { id: -ts, date: today, mood, note: null, ts, uid, source };
    set(derive([optimistic, ...useCheckinStore.getState().history]));

    // Always a fresh row, so logging again later today adds an entry instead of overwriting. ON CONFLICT only guards two inserts landing on the same millisecond.
    await exec(
      `INSERT INTO checkins (date, mood, note, ts, uid, source) VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(uid, ts) DO NOTHING`,
      [today, mood, ts, uid, source]
    );
    set(derive(await readHistory()));
    mirrorCheckin(mood, today, ts, source);
    return ts;
  },

  setReasons: async (ts: number, reasons: string[], note: string | null) => {
    const uid = getActiveUid();
    const json = reasons.length > 0 ? JSON.stringify(reasons) : null;
    const text = note?.trim() ? note.trim() : null;
    await exec('UPDATE checkins SET reasons = ?, note = ? WHERE uid = ? AND ts = ?', [
      json,
      text,
      uid,
      ts,
    ]);
    set(derive(await readHistory()));
    mirrorReasons(ts, reasons, text);
  },
}));

async function readHistory(): Promise<CheckinRow[]> {
  return queryAll<CheckinRow>(
    'SELECT * FROM checkins WHERE uid = ? ORDER BY ts DESC LIMIT 2000',
    [getActiveUid()]
  );
}

/**
 * Pulls this account's mirrored check-ins from Firestore into local SQLite, so a fresh device knows what was logged elsewhere.
 * Each cloud doc's id is its ts, so ON CONFLICT DO NOTHING makes re-running this safe.
 */
async function syncCheckinsFromCloud(): Promise<void> {
  const db = getDb();
  const uid = getActiveUid();
  if (!db || uid === 'local') return;
  try {
    const user = await ensureSignedIn();
    if (!user || user.uid !== uid) return;

    const snap = await getDocs(
      query(collection(db, 'users', uid, 'checkins'), orderBy('ts', 'desc'), limit(2000))
    );
    if (snap.empty) return;

    for (const d of snap.docs) {
      const data = d.data() as {
        date: string;
        mood: unknown;
        ts: number;
        source?: EntrySource;
        reasons?: unknown;
        note?: unknown;
      };
      // Docs mirrored before the label scale stored a 0-4 number; translate them the same way the local migration does.
      const mood: Mood =
        typeof data.mood === 'number' ? legacyMoodToLabel(data.mood) : (data.mood as Mood);
      const reasons = Array.isArray(data.reasons)
        ? JSON.stringify(data.reasons.filter((x) => typeof x === 'string'))
        : null;
      const note = typeof data.note === 'string' ? data.note : null;
      await exec(
        `INSERT INTO checkins (date, mood, note, ts, uid, source, reasons) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid, ts) DO UPDATE SET
           reasons = COALESCE(checkins.reasons, excluded.reasons),
           note = COALESCE(checkins.note, excluded.note)`,
        // Docs mirrored before the companion could log a check-in have no source; they were all taps.
        [data.date, mood, note, data.ts, uid, data.source ?? 'manual', reasons]
      );
    }
  } catch {
  }
}

function mirrorCheckin(
  mood: Mood,
  date: string,
  ts: number,
  source: EntrySource
): void {
  const db = getDb();
  if (!db) return;
  void (async () => {
    try {
      const user = await ensureSignedIn();
      if (!user) return;
      await setDoc(doc(db, 'users', user.uid, 'checkins', String(ts)), {
        date,
        mood,
        ts,
        source,
      });
    } catch {
    }
  })();
}

function mirrorReasons(ts: number, reasons: string[], note: string | null): void {
  const db = getDb();
  if (!db) return;
  void (async () => {
    try {
      const user = await ensureSignedIn();
      if (!user) return;
      await setDoc(
        doc(db, 'users', user.uid, 'checkins', String(ts)),
        { reasons, note },
        { merge: true }
      );
    } catch {
    }
  })();
}
