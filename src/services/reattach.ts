/**
 * Which local tables get moved from the uid='local' sentinel to a real account uid, and the SQL that does it.
 * Kept out of db.ts so scripts/selfcheck-db-reattach.ts can run these exact statements under plain Node without expo-sqlite.
 */

/**
 * Tables holding recorded user data scoped by uid; `conversations` comes before `chat_messages` so the parent row moves first.
 * Preference tables (consent_settings, phq4_cadence, etc.) are left out on purpose: a missing row just means the default, and a consent decision must not be moved onto an account that never made it.
 */
export const REATTACHED_TABLES = [
  'conversations',
  'chat_messages',
  'checkins',
  'phq4_results',
  'sensing_events',
  'app_events',
] as const;

/**
 * OR IGNORE, not a plain UPDATE: checkins, conversations and sensing_events have UNIQUE indexes on uid, and a collision is expected because the cloud sync often already pulled the same row down under the real uid.
 * A plain UPDATE would throw and abort sign-in; skipped rows stay under 'local' and are retried on the next sign-in.
 */
export const REATTACH_LOCAL_ROWS_SQL: string[] = REATTACHED_TABLES.map(
  (table) => `UPDATE OR IGNORE ${table} SET uid = ? WHERE uid = 'local'`
);
