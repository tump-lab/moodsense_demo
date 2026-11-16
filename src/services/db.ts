/** Local SQLite storage; all app data is written here first and uploaded to Firebase in the background. */
import * as SQLite from 'expo-sqlite';
import { REATTACHED_TABLES, REATTACH_LOCAL_ROWS_SQL } from './reattach';

/** Id given to chat messages saved before conversations existed (old 1:1 companion data). */
const LEGACY_CONVERSATION_ID = 'legacy';

const DB_NAME = 'moodsense.db';

export type Mood = 'calm' | 'good' | 'stressed' | 'low' | 'tired';

/**
 * Which surface produced a check-in or a PHQ-4 result. 'manual' is the mood tiles on Home and the
 * four-question Mood Check screen; 'companion_chat' is a draft the companion pulled out of a
 * conversation and the user confirmed inline. A PHQ-4 answered by confirming a prefill is not the
 * same measurement as one tapped through the instrument, so analysis must be able to split them.
 *
 * 'companion_voice' is the same confirmed draft, but read out of *spoken* input — a voice note or a
 * live call — so speech-to-text sits between what the user said and what the model read. A
 * mis-transcription is a failure mode typing does not have, and an analysis that wants to exclude
 * it has to be able to find those rows. Only check-ins are ever written this way: a PHQ-4 is never
 * drafted from speech.
 */
export type EntrySource = 'manual' | 'companion_chat' | 'companion_voice';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await runMigrations(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function exec(
  sql: string,
  params: SQLite.SQLiteBindParams = []
): Promise<SQLite.SQLiteRunResult> {
  const db = await getDatabase();
  return db.runAsync(sql, params);
}

export async function queryAll<T>(
  sql: string,
  params: SQLite.SQLiteBindParams = []
): Promise<T[]> {
  const db = await getDatabase();
  return db.getAllAsync<T>(sql, params);
}

export async function migrate(): Promise<void> {
  const db = await getDatabase();
  await runMigrations(db);
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      mood TEXT,
      note TEXT,
      ts INTEGER,
      uid TEXT NOT NULL DEFAULT 'local',
      source TEXT NOT NULL DEFAULT 'manual',
      UNIQUE(uid, ts)
    );

    CREATE TABLE IF NOT EXISTS phq4_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER,
      q1 INTEGER,
      q2 INTEGER,
      q3 INTEGER,
      q4 INTEGER,
      total INTEGER,
      anxiety INTEGER,
      depression INTEGER,
      uid TEXT NOT NULL DEFAULT 'local',
      source TEXT NOT NULL DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS sensing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT,
      ts INTEGER,
      payload TEXT,
      uploaded INTEGER DEFAULT 0,
      uid TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT,
      content TEXT,
      audioUri TEXT,
      ts INTEGER,
      uid TEXT NOT NULL DEFAULT 'local',
      transcript TEXT,
      audioUrl TEXT
    );

    CREATE TABLE IF NOT EXISTS app_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT,
      props TEXT,
      ts INTEGER,
      uploaded INTEGER DEFAULT 0,
      uid TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT NOT NULL,
      uid TEXT NOT NULL DEFAULT 'local',
      startedAt INTEGER,
      endedAt INTEGER,
      title TEXT,
      UNIQUE(uid, id)
    );
  `);

  await backfillUidScoping(db);
  await migrateCheckinsToMultiEntry(db);
  await backfillTranscriptColumn(db);
  await backfillAudioUrlColumn(db);
  await backfillDedupeKeyColumn(db);
  await backfillConversationsTable(db);
  await backfillSourceColumns(db);
  await addCheckinReasonsColumn(db);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_checkins_uid ON checkins(uid);
    CREATE INDEX IF NOT EXISTS idx_checkins_uid_date ON checkins(uid, date);
    CREATE INDEX IF NOT EXISTS idx_phq4_results_uid ON phq4_results(uid);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_uid ON chat_messages(uid);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_uid_conversation
      ON chat_messages(uid, conversationId);
    CREATE INDEX IF NOT EXISTS idx_conversations_uid ON conversations(uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sensing_events_uid_stream_dedupe
      ON sensing_events(uid, stream, dedupe_key);
  `);
}

async function hasColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

/**
 * `checkins` is rebuilt because ALTER TABLE cannot change its old UNIQUE(date) to UNIQUE(date, uid).
 * Without that, a second account on the same device would overwrite the first account's row for the day.
 */
async function backfillUidScoping(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const table of ['phq4_results', 'sensing_events', 'chat_messages', 'app_events']) {
    if (!(await hasColumn(db, table, 'uid'))) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN uid TEXT NOT NULL DEFAULT 'local';`);
    }
  }

  if (!(await hasColumn(db, 'checkins', 'uid'))) {
    await db.execAsync(`
      ALTER TABLE checkins RENAME TO checkins_old;
      CREATE TABLE checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        mood INTEGER,
        note TEXT,
        ts INTEGER,
        uid TEXT NOT NULL DEFAULT 'local',
        UNIQUE(date, uid)
      );
      INSERT INTO checkins (id, date, mood, note, ts, uid)
        SELECT id, date, mood, note, ts, 'local' FROM checkins_old;
      DROP TABLE checkins_old;
    `);
  }
}

/**
 * Maps the old 0-4 mood scale to the four-category one for existing local rows.
 * Awful/Low become 'low', Okay is 'calm', Good/Great are 'good'; nothing maps to 'stressed' since the old scale had no such option.
 */
export function legacyMoodToLabel(mood: number | null): Mood {
  if (mood == null) return 'calm';
  if (mood <= 1) return 'low';
  if (mood === 2) return 'calm';
  return 'good';
}

/**
 * Detects the old one-row-per-day schema by looking for a UNIQUE index on exactly {date, uid}.
 * Checking origin 'u' alone is not enough: the current UNIQUE(uid, ts) also reports 'u', and the rebuild would then run on every launch.
 */
async function migrateCheckinsToMultiEntry(db: SQLite.SQLiteDatabase): Promise<void> {
  const indices = await db.getAllAsync<{ name: string; origin: string }>(
    'PRAGMA index_list(checkins)'
  );
  let hasOldUniqueConstraint = false;
  for (const idx of indices) {
    if (idx.origin !== 'u') continue;
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA index_info(${idx.name})`);
    const colNames = new Set(cols.map((c) => c.name));
    if (colNames.has('date') && colNames.has('uid') && !colNames.has('ts')) {
      hasOldUniqueConstraint = true;
      break;
    }
  }
  if (!hasOldUniqueConstraint) return;

  const oldRows = await db.getAllAsync<{
    id: number;
    date: string | null;
    mood: number | null;
    note: string | null;
    ts: number | null;
    uid: string;
  }>('SELECT id, date, mood, note, ts, uid FROM checkins');

  await db.execAsync(`
    ALTER TABLE checkins RENAME TO checkins_old_single_per_day;
    CREATE TABLE checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      mood TEXT,
      note TEXT,
      ts INTEGER,
      uid TEXT NOT NULL DEFAULT 'local',
      UNIQUE(uid, ts)
    );
  `);

  for (const row of oldRows) {
    await db.runAsync(
      `INSERT INTO checkins (date, mood, note, ts, uid) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid, ts) DO NOTHING`,
      [row.date, legacyMoodToLabel(row.mood), row.note, row.ts, row.uid]
    );
  }

  await db.execAsync('DROP TABLE checkins_old_single_per_day;');
}

async function backfillTranscriptColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await hasColumn(db, 'chat_messages', 'transcript'))) {
    await db.execAsync('ALTER TABLE chat_messages ADD COLUMN transcript TEXT;');
  }
}

async function backfillAudioUrlColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await hasColumn(db, 'chat_messages', 'audioUrl'))) {
    await db.execAsync('ALTER TABLE chat_messages ADD COLUMN audioUrl TEXT;');
  }
}

/** Existing rows keep dedupe_key = NULL, which is safe because SQLite treats each NULL as distinct in a UNIQUE index. */
async function backfillDedupeKeyColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await hasColumn(db, 'sensing_events', 'dedupe_key'))) {
    await db.execAsync('ALTER TABLE sensing_events ADD COLUMN dedupe_key TEXT;');
  }
}

async function backfillConversationsTable(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await hasColumn(db, 'chat_messages', 'conversationId'))) {
    await db.execAsync('ALTER TABLE chat_messages ADD COLUMN conversationId TEXT;');
  }

  const uidsNeeding = await db.getAllAsync<{ uid: string }>(
    'SELECT DISTINCT uid FROM chat_messages WHERE conversationId IS NULL'
  );
  for (const { uid } of uidsNeeding) {
    const bounds = await db.getAllAsync<{ minTs: number | null; maxTs: number | null }>(
      'SELECT MIN(ts) as minTs, MAX(ts) as maxTs FROM chat_messages WHERE uid = ? AND conversationId IS NULL',
      [uid]
    );
    const startedAt = bounds[0]?.minTs ?? Date.now();
    const endedAt = bounds[0]?.maxTs ?? startedAt;
    await db.runAsync(
      `INSERT INTO conversations (id, uid, startedAt, endedAt, title) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid, id) DO NOTHING`,
      [LEGACY_CONVERSATION_ID, uid, startedAt, endedAt, 'Earlier conversation']
    );
    await db.runAsync(
      'UPDATE chat_messages SET conversationId = ? WHERE uid = ? AND conversationId IS NULL',
      [LEGACY_CONVERSATION_ID, uid]
    );
  }
}

/**
 * Runs after the checkins rebuilds above, which recreate the table from its historical shape and
 * would otherwise drop the column. Everything written before the companion could log a check-in
 * came from a tap, so 'manual' is the correct default for existing rows.
 */
async function backfillSourceColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const table of ['checkins', 'phq4_results']) {
    if (!(await hasColumn(db, table, 'source'))) {
      await db.execAsync(
        `ALTER TABLE ${table} ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';`
      );
    }
  }
}

/** JSON array of reason tag ids picked after a check-in (checkin/moodReasons.ts); NULL when skipped. Free text for "Other" goes in `note`. */
async function addCheckinReasonsColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await hasColumn(db, 'checkins', 'reasons'))) {
    await db.execAsync('ALTER TABLE checkins ADD COLUMN reasons TEXT;');
  }
}

export async function reattachOrphanedLocalRows(uid: string): Promise<void> {
  if (!uid || uid === 'local') return;
  for (const sql of REATTACH_LOCAL_ROWS_SQL) {
    await exec(sql, [uid]);
  }
}

/** Deletes rows recorded while nobody was signed in, so they can't be claimed by whichever account signs in next. */
export async function clearOrphanedLocalRows(): Promise<void> {
  for (const table of REATTACHED_TABLES) {
    await exec(`DELETE FROM ${table} WHERE uid = 'local'`);
  }
}

export interface CheckinRow {
  id: number;
  date: string;
  mood: Mood;
  /** Free text from the reason sheet's "Other" option. */
  note: string | null;
  ts: number;
  uid: string;
  source: EntrySource;
  /** JSON array of reason tag ids; read it with parseReasons(). */
  reasons?: string | null;
}

export interface Phq4ResultRow {
  id: number;
  ts: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  total: number;
  anxiety: number;
  depression: number;
  uid: string;
  source: EntrySource;
}

export interface SensingEventRow {
  id: number;
  stream: string;
  ts: number;
  payload: string;
  uploaded: number;
  uid: string;
  dedupe_key: string | null;
}

export interface ChatMessageRow {
  id: number;
  role: string;
  content: string;
  audioUri: string | null;
  ts: number;
  uid: string;
  transcript: string | null;
  audioUrl: string | null;
  conversationId: string | null;
}

export interface ConversationRow {
  id: string;
  uid: string;
  startedAt: number;
  endedAt: number | null;
  title: string | null;
}

export interface AppEventRow {
  id: number;
  event: string;
  props: string;
  ts: number;
  uploaded: number;
  uid: string;
}
