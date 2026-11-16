/**
 * What the Recharge tab suggests: a small catalog of things to do, a hand-ordered list per mood,
 * and a nudge from the reasons picked on Home. Pure data and logic, no React, so scripts can run it.
 */
import type { Mood } from '../../services/db';
import type { ActivityGoal } from '../activities/config';
import type { SoundscapeId } from '../sounds/config';
import type { GameId } from '../games/config';

/** Every list on Recharge, picks or a category, shows at most this many. */
export const MAX_RECHARGE_PICKS = 3;

export type RechargeAction =
  | { kind: 'activity'; activityId: string; goal?: ActivityGoal }
  | { kind: 'sound'; soundId: SoundscapeId }
  | { kind: 'game'; gameId: GameId }
  /** Opens a short writing prompt; the answer stays on this phone. */
  | { kind: 'reflect'; prompt: string }
  /** A suggestion to do away from the phone, shown as a short card with a Done button. */
  | { kind: 'tip'; body: string }
  | { kind: 'video'; url: string };

export type RechargeCategory =
  | 'breathing'
  | 'mindfulness'
  | 'relaxation'
  | 'music'
  | 'videos'
  | 'reflection'
  | 'exercise'
  | 'games';

export const CATEGORY_LABELS: Record<RechargeCategory, string> = {
  breathing: 'Breathing',
  mindfulness: 'Mindfulness',
  relaxation: 'Relaxation',
  music: 'Music',
  videos: 'Videos',
  reflection: 'Reflection',
  exercise: 'Short Exercises',
  games: 'Games',
};

export const CATEGORY_ORDER: readonly RechargeCategory[] = [
  'breathing',
  'mindfulness',
  'relaxation',
  'music',
  'videos',
  'reflection',
  'exercise',
  'games',
];

export interface RechargeItem {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  category: RechargeCategory;
  action: RechargeAction;
}

const VIDEO_URL = 'https://www.youtube.com/results?search_query=relaxing+nature+scenery+short';
const UPLIFTING_VIDEO_URL = 'https://www.youtube.com/results?search_query=uplifting+short+video+wholesome';

export const RECHARGE_ITEMS: readonly RechargeItem[] = [
  // Breathing
  { id: 'breathing', title: 'Breathing Exercise', subtitle: 'Box breathing · 2 min', emoji: '\u{1FAE7}', category: 'breathing', action: { kind: 'activity', activityId: 'box-breathing', goal: 'focused' } },
  { id: 'calming-breath', title: 'Calming Breath', subtitle: 'Longer out-breath · 1 min', emoji: '\u{1F319}', category: 'breathing', action: { kind: 'activity', activityId: 'calming-breath', goal: 'calm' } },
  // Mindfulness
  { id: 'mindfulness', title: 'Mindfulness Moment', subtitle: '5-4-3-2-1 senses · 2 min', emoji: '\u{1F441}', category: 'mindfulness', action: { kind: 'activity', activityId: 'senses-grounding', goal: 'present' } },
  { id: 'gratitude', title: 'Gratitude Exercise', subtitle: 'Three good things · 2 min', emoji: '\u{1F33F}', category: 'mindfulness', action: { kind: 'activity', activityId: 'gratitude-pause', goal: 'lighter' } },
  // Relaxation
  { id: 'guided-relaxation', title: 'Guided Relaxation', subtitle: 'Body scan · 2 min', emoji: '\u{1F9D8}', category: 'relaxation', action: { kind: 'activity', activityId: 'body-scan', goal: 'grounded' } },
  { id: 'short-rest', title: 'Take A Short Rest', subtitle: 'Eyes closed · 5 min', emoji: '\u{1F6CB}', category: 'relaxation', action: { kind: 'tip', body: 'Set a 5-minute timer, close your eyes and let your body go heavy. You do not need to sleep; just stop doing for a moment.' } },
  { id: 'reduce-screen', title: 'Screen Break', subtitle: 'Put the phone down · 15 min', emoji: '\u{1F4F5}', category: 'relaxation', action: { kind: 'tip', body: 'Put your phone face down or in another room for the next 15 minutes. Tired eyes and a tired mind both recover faster without a screen.' } },
  { id: 'drink-water', title: 'Drink Some Water', subtitle: 'A glass, right now', emoji: '\u{1F4A7}', category: 'relaxation', action: { kind: 'tip', body: 'Even mild dehydration can feel like tiredness. Get up, pour a glass of water and drink it slowly.' } },
  { id: 'sleep-tip', title: 'Plan A Better Night', subtitle: 'Sleep tip', emoji: '\u{1F6CF}', category: 'relaxation', action: { kind: 'tip', body: 'Tonight, try winding down 30 minutes earlier: dim the lights, put screens away and keep the same wake-up time tomorrow.' } },
  // Music
  { id: 'calming-audio', title: 'Calming Sounds', subtitle: 'Gentle rain', emoji: '\u{1F327}', category: 'music', action: { kind: 'sound', soundId: 'rain' } },
  { id: 'relaxing-music', title: 'Relaxing Sounds', subtitle: 'Ocean waves', emoji: '\u{1F30A}', category: 'music', action: { kind: 'sound', soundId: 'ocean' } },
  { id: 'forest-sounds', title: 'Forest Sounds', subtitle: 'Birds and leaves', emoji: '\u{1F332}', category: 'music', action: { kind: 'sound', soundId: 'forest' } },
  { id: 'fireplace-sounds', title: 'Fireplace', subtitle: 'Soft crackle', emoji: '\u{1F525}', category: 'music', action: { kind: 'sound', soundId: 'fireplace' } },
  // Videos
  { id: 'relaxing-video', title: 'Relaxing Video', subtitle: 'Nature scenery · opens YouTube', emoji: '\u{1F3DE}', category: 'videos', action: { kind: 'video', url: VIDEO_URL } },
  { id: 'uplifting-video', title: 'Uplifting Video', subtitle: 'Something kind · opens YouTube', emoji: '\u{1F31E}', category: 'videos', action: { kind: 'video', url: UPLIFTING_VIDEO_URL } },
  // Reflection
  // The only item that asks for typing; everything else is one tap.
  { id: 'reflection', title: 'Write It Down', subtitle: 'A few lines about today', emoji: '\u{1F4D3}', category: 'reflection', action: { kind: 'reflect', prompt: 'What is on your mind today? A few lines is enough, good or hard.' } },
  // Short exercises
  { id: 'stretching', title: 'Stretching', subtitle: 'Four seated stretches · 1 min', emoji: '\u{1F938}', category: 'exercise', action: { kind: 'activity', activityId: 'quick-stretch' } },
  { id: 'short-walk', title: 'Take A Short Walk', subtitle: 'Outside · 10 min', emoji: '\u{1F6B6}', category: 'exercise', action: { kind: 'tip', body: 'Step outside for a 10-minute walk. No destination needed; just notice the air, the light and what you pass.' } },
  { id: 'stand-tall', title: 'Stand Tall', subtitle: 'Posture and self-talk · 1 min', emoji: '\u{1F31F}', category: 'exercise', action: { kind: 'activity', activityId: 'power-pose', goal: 'confident' } },
  { id: 'light-exercise', title: 'Light Exercise', subtitle: 'Move a little · 10 min', emoji: '\u{1F3C3}', category: 'exercise', action: { kind: 'tip', body: 'A light jog, a few flights of stairs or a short dance to one song. Gentle movement helps keep a good mood going.' } },
  // Games
  { id: 'mood-lift', title: 'Mood-Lifting Game', subtitle: 'Bubble pop · no score', emoji: '\u{1FAE7}', category: 'games', action: { kind: 'game', gameId: 'bubble-pop' } },
  { id: 'ripple-pond', title: 'Ripple Pond', subtitle: 'Calm and slow', emoji: '\u{1F4A7}', category: 'games', action: { kind: 'game', gameId: 'ripple-pond' } },
  { id: 'constellation', title: 'Constellation', subtitle: 'Connect the stars', emoji: '\u{2B50}', category: 'games', action: { kind: 'game', gameId: 'constellation' } },
  // Connection, offered by mood rather than browsed
  { id: 'contact-trusted', title: 'Reach Out To Someone', subtitle: 'A friend or family member', emoji: '\u{1F4AC}', category: 'reflection', action: { kind: 'tip', body: 'Send a short message to someone you trust. It can be as simple as "Thinking of you, how are you doing?"' } },
  { id: 'share-moment', title: 'Share The Good Moment', subtitle: 'Tell someone', emoji: '\u{1F91D}', category: 'reflection', action: { kind: 'tip', body: 'Tell someone about what went well today. Sharing a good moment makes it last longer for both of you.' } },
  { id: 'keep-routine', title: 'Keep Your Routine', subtitle: 'What is working', emoji: '\u{1F504}', category: 'reflection', action: { kind: 'tip', body: 'Whatever got you here today, sleep, movement, people, keep it in tomorrow\'s plan too.' } },
];

/** Hand-ordered per mood, best first; the first three are shown unless a reason moves one up. */
export const MOOD_RECHARGE: Record<Mood, readonly string[]> = {
  stressed: ['breathing', 'guided-relaxation', 'short-walk', 'stretching', 'mindfulness', 'reflection'],
  low: ['mood-lift', 'gratitude', 'contact-trusted', 'short-walk', 'reflection', 'calming-audio'],
  tired: ['short-rest', 'calming-breath', 'stretching', 'reduce-screen', 'drink-water', 'sleep-tip', 'relaxing-music', 'relaxing-video'],
  calm: ['mindfulness', 'reflection', 'light-exercise', 'keep-routine', 'calming-audio'],
  good: ['gratitude', 'share-moment', 'keep-routine', 'light-exercise', 'reflection'],
};

/** Before anyone has checked in today: one breath, one movement, one sound. */
const DEFAULT_RECHARGE: readonly string[] = ['calming-breath', 'stretching', 'calming-audio'];

/**
 * A reason picked on Home pulls the first matching suggestion to the front, if this mood offers it.
 * The tags are shared by all moods, so each list mixes ideas for hard days (found in the
 * Stressed, Low and Tired lists) and good ones (found in the Calm and Good lists).
 */
const REASON_BOOST: Record<string, readonly string[]> = {
  sleep: ['short-rest', 'sleep-tip', 'calming-breath', 'keep-routine'],
  work_study: ['short-walk', 'breathing', 'reflection', 'share-moment'],
  people: ['contact-trusted', 'share-moment', 'reflection'],
  body: ['stretching', 'drink-water', 'short-rest', 'light-exercise'],
  me_time: ['guided-relaxation', 'calming-audio', 'mindfulness', 'keep-routine', 'light-exercise'],
};

const BY_ID = new Map(RECHARGE_ITEMS.map((i) => [i.id, i] as const));

export function getRechargeItem(id: string): RechargeItem | undefined {
  return BY_ID.get(id);
}

/** The first three of a category, in catalog order; the rest are reached through picks only. */
export function itemsInCategory(category: RechargeCategory): RechargeItem[] {
  return RECHARGE_ITEMS.filter((i) => i.category === category).slice(0, MAX_RECHARGE_PICKS);
}

/** At most `max` picks for the latest mood, reason matches first, otherwise the mood's own order. */
export function recommendRecharge(
  mood: Mood | null,
  reasons: readonly string[] = [],
  max: number = MAX_RECHARGE_PICKS
): RechargeItem[] {
  const base = mood ? MOOD_RECHARGE[mood] : DEFAULT_RECHARGE;
  const boosted: string[] = [];
  if (mood) {
    for (const r of reasons) {
      const match = (REASON_BOOST[r] ?? []).find((id) => base.includes(id) && !boosted.includes(id));
      if (match) boosted.push(match);
    }
  }
  const order = [...boosted, ...base.filter((id) => !boosted.includes(id))];
  return order
    .map((id) => BY_ID.get(id))
    .filter((i): i is RechargeItem => i != null)
    .slice(0, Math.max(0, max));
}
