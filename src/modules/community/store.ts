/**
 * Stores the community the user picked, in our own `community_selection` SQLite table created lazily here.
 * SQLite is the source of truth; with Firebase on, the choice is also mirrored best-effort under `users/{uid}`.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { exec, queryAll } from '../../services/db';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';

async function ensureTable(): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS community_selection (
       uid TEXT PRIMARY KEY,
       community_id TEXT NOT NULL,
       ts INTEGER
     )`
  );
}

/**
 * Pulls the mirrored community down into local SQLite, since a fresh device otherwise cannot know one was already chosen.
 * No-op when Firebase is off or the session is anonymous.
 */
async function syncCommunityFromCloud(): Promise<void> {
  const db = getDb();
  const uid = getActiveUid();
  if (!db || uid === 'local') return;
  try {
    const user = await ensureSignedIn();
    if (!user || user.uid !== uid) return;

    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.data() as { community?: string; communityUpdatedAt?: number } | undefined;
    if (!data?.community) return;

    await exec(
      `INSERT INTO community_selection (uid, community_id, ts) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET community_id = excluded.community_id, ts = excluded.ts
       WHERE excluded.ts > community_selection.ts`,
      [uid, data.community, data.communityUpdatedAt ?? 0]
    );
  } catch {
    // Best-effort; local SQLite stays as it was.
  }
}

/**
 * Last answer for the active uid, so a screen that needs the community can have it on its first
 * frame instead of rendering a placeholder and swapping. Module scope: it describes the session,
 * and has to outlive any one screen's mount.
 */
let cached: { uid: string; communityId: string | null } | null = null;

/**
 * The community without touching the database, or `undefined` when it has not been read yet this
 * session. Lets a screen paint the right thing immediately on a re-open rather than flashing a
 * neutral fallback while an await resolves.
 */
export function peekChosenCommunity(): string | null | undefined {
  return cached?.uid === getActiveUid() ? cached.communityId : undefined;
}

async function readLocalCommunity(uid: string): Promise<string | null> {
  const rows = await queryAll<{ community_id: string }>(
    'SELECT community_id FROM community_selection WHERE uid = ?',
    [uid]
  );
  return rows[0]?.community_id ?? null;
}

/**
 * The locally stored choice. Deliberately does **not** sync from the cloud first: that is a
 * Firestore round trip, and having it on this path meant the Community map drew its neutral
 * fallback skyline until the network answered, then redrew as the real city — the flash this
 * function used to cause. Callers that want another device's choice call
 * syncChosenCommunityFromCloud() behind their first paint.
 */
export async function getChosenCommunity(): Promise<string | null> {
  const uid = getActiveUid();
  try {
    await ensureTable();
    const communityId = await readLocalCommunity(uid);
    cached = { uid, communityId };
    return communityId;
  } catch {
    // DB unavailable: treat as not chosen yet so the UI still works.
    return null;
  }
}

/** Pulls a choice made on another device into SQLite, then returns the settled value. */
export async function syncChosenCommunityFromCloud(): Promise<string | null> {
  const uid = getActiveUid();
  try {
    await ensureTable();
    await syncCommunityFromCloud();
    const communityId = await readLocalCommunity(uid);
    cached = { uid, communityId };
    return communityId;
  } catch {
    return cached?.uid === uid ? cached.communityId : null;
  }
}

export async function setChosenCommunity(communityId: string): Promise<void> {
  const uid = getActiveUid();
  const ts = Date.now();
  cached = { uid, communityId };
  await ensureTable();
  await exec(
    `INSERT INTO community_selection (uid, community_id, ts) VALUES (?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET community_id = excluded.community_id, ts = excluded.ts`,
    [uid, communityId, ts]
  );
  mirrorCommunity(communityId, ts);
}

function mirrorCommunity(communityId: string, ts: number): void {
  const db = getDb();
  if (!db) return;
  void (async () => {
    try {
      const user = await ensureSignedIn();
      if (!user) return;
      await setDoc(
        doc(db, 'users', user.uid),
        { community: communityId, communityUpdatedAt: ts },
        { merge: true }
      );
    } catch {
      // Best-effort mirror; local SQLite stays the source of truth.
    }
  })();
}
