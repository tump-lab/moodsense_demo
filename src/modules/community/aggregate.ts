/**
 * Anonymous community mood aggregates. Kept free of React Native imports so the Node
 * self-check can run it; services/firebase is loaded lazily for the same reason.
 */
import { doc, getDoc } from 'firebase/firestore';

// Mirrors the five check-in categories in src/modules/checkin/moods.ts. Every reader
// below enumerates exactly these five keys, so a stray extra field on a Firestore doc is
// never read.
export type MoodLabel = 'Calm' | 'Good' | 'Stressed' | 'Low' | 'Tired';

export interface MoodBucket {
  label: MoodLabel;
  color: string;
  count: number;
}

/** Mirror of theme `colors.mood.*.mid`; the theme imports react-native, so hex literals keep this node-safe. */
export const BUCKET_COLORS: Record<MoodLabel, string> = {
  Calm: '#9ccbb0',
  Good: '#f0d27a',
  Stressed: '#f2b592',
  Low: '#adb6de',
  Tired: '#c9b8d8',
};

/** A rough everyday mix, made up for demos and not taken from any study: stress is common, low days less so. */
const MOCK_SHARES: Record<MoodLabel, number> = { Calm: 0.24, Good: 0.3, Stressed: 0.24, Low: 0.1, Tired: 0.12 };

/**
 * Sample counts that vary by `seed` but stay put for the same seed, so a community does not reshuffle
 * on every open. Every bucket is at least 2, so the sample shows all five moods.
 */
export function getMockNearbyMoods(seed = ''): MoodBucket[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const total = 40 + Math.floor(next() * 100);
  return (['Calm', 'Good', 'Stressed', 'Low', 'Tired'] as MoodLabel[]).map((label) => ({
    label,
    color: BUCKET_COLORS[label],
    // Up to 30% either way around the everyday mix.
    count: Math.max(2, Math.round(total * MOCK_SHARES[label] * (0.7 + next() * 0.6))),
  }));
}

/**
 * Sample data only while Developer mode is on. Otherwise reads the Firestore doc
 * `community_agg/{communityId}`, whose fields are lowercase bucket names -> counts; with no
 * Firebase or no doc, every bucket is 0.
 */
export async function getNearbyMoods(communityId: string): Promise<MoodBucket[]> {
  const { isDevModeEnabled } = await import('../settings/devMode');
  if (await isDevModeEnabled()) {
    const d = new Date();
    return getMockNearbyMoods(`${communityId}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }

  const { getDb } = await import('../../services/firebase');
  const remote = getDb();
  const snap = remote ? await getDoc(doc(remote, 'community_agg', communityId)) : null;
  const data = snap?.exists() ? snap.data() : {};

  const readCount = (field: string): number => {
    const v = (data as Record<string, unknown>)[field];
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : 0;
  };

  const buckets: MoodBucket[] = (
    ['Calm', 'Good', 'Stressed', 'Low', 'Tired'] as MoodLabel[]
  ).map((label) => ({
    label,
    color: BUCKET_COLORS[label],
    count: readCount(label.toLowerCase()),
  }));

  return buckets;
}
