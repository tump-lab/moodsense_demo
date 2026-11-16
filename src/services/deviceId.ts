/**
 * Anonymous random device id, stored locally and never tied to identity.
 * services/db loads expo-sqlite (native), so it is imported lazily inside getDeviceId() to keep this file Node-safe.
 */

type DbModule = typeof import('./db');

function db(): Promise<DbModule> {
  return import('./db');
}

let cachedDeviceId: string | null = null;

// On first launch two uploaders can call getDeviceId() at once; without this guard each would create its own id and split one device's data across two Firestore docs.
// Overlapping callers share the same promise instead.
let inFlight: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  if (!inFlight) {
    inFlight = resolveDeviceId().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function resolveDeviceId(): Promise<string> {
  const { exec, queryAll } = await db();
  await exec(
    'CREATE TABLE IF NOT EXISTS sensing_meta (key TEXT PRIMARY KEY, value TEXT)'
  );
  const rows = await queryAll<{ value: string }>(
    "SELECT value FROM sensing_meta WHERE key = 'device_id'"
  );
  const existing = rows[0]?.value;
  if (existing) {
    cachedDeviceId = existing;
    return existing;
  }
  const fresh =
    'dev-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10);
  await exec(
    "INSERT OR REPLACE INTO sensing_meta (key, value) VALUES ('device_id', ?)",
    [fresh]
  );
  cachedDeviceId = fresh;
  return fresh;
}
