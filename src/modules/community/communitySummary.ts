/**
 * Short encouraging line built from the aggregate bucket counts CommunityFeed shows, cached once per user, community, day and mood valence because this screen generates on focus rather than behind a button.
 * Buckets below k already arrive as 0; when every bucket is 0 this returns null without calling the LLM.
 */
import { exec, queryAll, type Mood } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { chatComplete } from '../../services/llm';
import { logEvent } from '../../services/logging';
import type { MoodBucket } from './aggregate';
import { isAiLive } from '../../services/aiGateway';
import { isDevModeEnabled } from '../settings/devMode';
import {
  buildCommunitySummaryPrompt,
  moodValence,
  pickCommunityDemoLine,
  type UserMoodValence,
} from './communitySummaryPrompt';

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// v2 adds valence to the key so a same-day mood change regenerates the line instead of showing one written for the other mood.
// Renamed rather than migrated: it is a disposable model-output cache, so v1 rows are just never read again.
let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS community_summary_cache_v2 (
         uid TEXT NOT NULL,
         community_id TEXT NOT NULL,
         date TEXT NOT NULL,
         valence TEXT NOT NULL,
         summary TEXT NOT NULL,
         PRIMARY KEY (uid, community_id, date, valence)
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

async function readCache(
  uid: string,
  communityId: string,
  date: string,
  valence: UserMoodValence
): Promise<string | null> {
  await ensureTable();
  const rows = await queryAll<{ summary: string }>(
    'SELECT summary FROM community_summary_cache_v2 WHERE uid = ? AND community_id = ? AND date = ? AND valence = ?',
    [uid, communityId, date, valence]
  );
  return rows[0]?.summary ?? null;
}

async function writeCache(
  uid: string,
  communityId: string,
  date: string,
  valence: UserMoodValence,
  summary: string
): Promise<void> {
  await ensureTable();
  await exec(
    `INSERT INTO community_summary_cache_v2 (uid, community_id, date, valence, summary) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(uid, community_id, date, valence) DO UPDATE SET summary = excluded.summary`,
    [uid, communityId, date, valence, summary]
  );
}

/**
 * Returns today's cached line, or null when every bucket is 0.
 * Throws when the LLM call fails so the caller can fall back to a static line; a failed attempt is not cached, so the next focus can retry.
 */
export async function generateCommunitySummary(
  communityId: string,
  buckets: MoodBucket[],
  userMood: Mood | null
): Promise<string | null> {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;

  // Sample counts: a canned line, so nothing about them reaches a model or the cache real counts read.
  if (await isDevModeEnabled()) return pickCommunityDemoLine({ buckets, userValence: moodValence(userMood) });

  const uid = getActiveUid();
  const date = localDateStr(new Date());
  const userValence = moodValence(userMood);

  const cached = await readCache(uid, communityId, date, userValence);
  if (cached != null) return cached;

  const promptData = { buckets, userValence };

  // AI off for this account, kill switch on, or no provider key: pick a hand-written line.
  // Not cached on purpose, since there is no model call to save and a line that varies between visits is nicer.
  if (!isAiLive('chat')) {
    void logEvent('community_summary_demo', { communityId });
    return pickCommunityDemoLine(promptData);
  }

  const messages = buildCommunitySummaryPrompt(promptData);
  try {
    const text = await chatComplete(messages);
    await writeCache(uid, communityId, date, userValence, text);
    void logEvent('community_summary_generated', { communityId });
    return text;
  } catch (err) {
    void logEvent('community_summary_failed', {
      communityId,
      reason: err instanceof Error ? err.message : 'unknown_error',
    });
    throw err;
  }
}
