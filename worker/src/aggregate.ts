import { Firestore, type FsDoc } from './firestore';
import type { Env } from './types';

type Bucket = 'low' | 'calm' | 'good' | 'stressed' | 'tired';
const BUCKETS: Bucket[] = ['low', 'calm', 'good', 'stressed', 'tired'];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function asBucket(v: unknown): Bucket | null {
  return typeof v === 'string' && (BUCKETS as string[]).includes(v) ? (v as Bucket) : null;
}

function asNumber(f: { integerValue?: string; doubleValue?: number } | undefined): number {
  if (!f) return 0;
  return f.integerValue !== undefined ? Number(f.integerValue) : f.doubleValue ?? 0;
}

/**
 * Hourly: rebuilds `community_agg/{communityId}` from each user's latest check-in in the last 24 hours, grouped by the
 * community they chose. Every count is written as-is. (The app only reads these docs; its rules forbid client writes.)
 */
export async function aggregateCommunityMoods(env: Env): Promise<string> {
  const fs = new Firestore(env);
  const cutoff = Date.now() - ONE_DAY_MS;
  const checkins = await fs.queryGroup('checkins', 'ts', 'GREATER_THAN_OR_EQUAL', { integerValue: String(cutoff) });

  // A user can log several check-ins a day; keep only their latest, like the Insights chart does.
  const latest = new Map<string, { mood: Bucket; ts: number }>();
  for (const doc of checkins) {
    const parts = doc.name.split('/');
    // .../documents/users/{uid}/checkins/{id}
    const uid = parts[parts.length - 3];
    if (parts[parts.length - 4] !== 'users' || !uid) continue;
    const mood = asBucket(doc.fields?.mood?.stringValue);
    const ts = asNumber(doc.fields?.ts);
    if (!mood) continue;
    const prev = latest.get(uid);
    if (!prev || ts > prev.ts) latest.set(uid, { mood, ts });
  }
  if (latest.size === 0) return 'No check-ins in the last 24h; nothing to aggregate.';

  const uids = [...latest.keys()];
  const users = await fs.getAll(uids.map((uid) => fs.docName(`users/${uid}`)));
  const byCommunity = new Map<string, Record<Bucket, number>>();
  uids.forEach((uid, i) => {
    const community = users[i]?.fields?.community?.stringValue;
    if (!community) return;
    const counts = byCommunity.get(community) ?? { low: 0, calm: 0, good: 0, stressed: 0, tired: 0 };
    counts[latest.get(uid)!.mood] += 1;
    byCommunity.set(community, counts);
  });
  if (byCommunity.size === 0) return 'No checked-in users have a chosen community yet; nothing to write.';

  const now = Date.now();
  const docs: FsDoc[] = [...byCommunity].map(([community, counts]) => ({
    name: fs.docName(`community_agg/${community}`),
    fields: {
      ...Object.fromEntries(BUCKETS.map((b) => [b, { integerValue: String(counts[b]) }])),
      updatedAt: { integerValue: String(now) },
    },
  }));
  await fs.set(docs);
  return `Wrote community_agg for ${byCommunity.size} communities: ${[...byCommunity.keys()].join(', ')}`;
}
