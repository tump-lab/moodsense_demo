/**
 * The growth level on the You tab: one number standing for how steadily someone has been checking
 * in, and how much of what they logged sat on the lighter side. A tree is drawn from it.
 *
 * Two deliberate choices about what it can and cannot say:
 *
 * - **Frequency is most of it.** Showing up is the behaviour the app can honestly ask for, so it is
 *   worth POINTS_FOR_FREQUENCY on its own — enough to reach LEVEL_TIERS[3] with nothing else. A
 *   participant having the worst month of their life who still checks in every day keeps a healthy
 *   tree. Only the top two levels need the mood side at all.
 * - **Nothing here can fall because a day was hard.** Every component is non-negative and additive,
 *   so a heavy stretch costs the positivity points it never earned and takes nothing away from the
 *   frequency points already banked. A level that punished low moods would be a reason to log a
 *   cheerful lie, which would corrupt the only data the study has.
 *
 * It is still a reflection rather than a prize: the window is short, so the level is losable by
 * stopping, which is the only thing it is meant to notice.
 *
 * Keep this file free of React / React Native / Expo imports so scripts/selfcheck-rewards.ts can
 * run it under plain Node.
 */
import type { Mood } from '../../services/db';
import { isPositiveMood } from '../checkin/moods';

/** Days of history the level reads. Short on purpose — a level you cannot lose stops meaning "lately". */
export const LEVEL_WINDOW_DAYS = 30;

/** Streak length at which the streak component is full. Past this it stops paying, so it cannot dominate. */
export const STREAK_CAP_DAYS = 10;

export const POINTS_FOR_FREQUENCY = 60;
export const POINTS_FOR_POSITIVITY = 30;
export const POINTS_FOR_STREAK = 10;

export interface LevelEntry {
  /** Local date key, as the `checkins` table stores it. */
  date: string;
  mood: Mood;
}

export interface LevelStats {
  /** Days in the window with at least one check-in — the frequency component's numerator. */
  daysLogged: number;
  windowDays: number;
  /** Check-ins in the window, which can exceed daysLogged. */
  checkins: number;
  /** Share of those check-ins that were Calm or Good; null when there were none to read. */
  positiveShare: number | null;
  /** Consecutive days ending today with a check-in, as computed by checkin/streak.ts. */
  streak: number;
  /** 0-100. */
  points: number;
}

/**
 * `windowDates` is the set of local date keys the level looks at — normally the last
 * LEVEL_WINDOW_DAYS ending today, passed in rather than derived so the caller owns "today".
 * Entries outside it are ignored, so the whole check-in history can be handed over as-is.
 */
export function computeLevelStats(
  entries: readonly LevelEntry[],
  windowDates: readonly string[],
  streak: number
): LevelStats {
  const window = new Set(windowDates);
  const windowDays = Math.max(1, window.size);
  const inWindow = entries.filter((e) => window.has(e.date));
  const daysLogged = new Set(inWindow.map((e) => e.date)).size;
  const positive = inWindow.filter((e) => isPositiveMood(e.mood)).length;
  const positiveShare = inWindow.length === 0 ? null : positive / inWindow.length;
  const streakShare = Math.min(Math.max(0, streak), STREAK_CAP_DAYS) / STREAK_CAP_DAYS;

  const points = Math.round(
    POINTS_FOR_FREQUENCY * (daysLogged / windowDays) +
      POINTS_FOR_POSITIVITY * (positiveShare ?? 0) +
      POINTS_FOR_STREAK * streakShare
  );

  return {
    daysLogged,
    windowDays,
    checkins: inWindow.length,
    positiveShare,
    streak,
    points: Math.max(0, Math.min(100, points)),
  };
}

export interface LevelTier {
  level: number;
  name: string;
  /** Which drawing GrowthTree uses. Indexes its stage table; nothing else reads it. */
  stage: number;
  /** Lowest `points` that reaches this tier. Ascending, and the first must be 0. */
  minPoints: number;
  /** One line in the app's voice about what the level is noticing. Never praise for a mood. */
  blurb: string;
}

export const LEVEL_TIERS: readonly LevelTier[] = [
  {
    level: 1,
    name: 'Seed',
    stage: 0,
    minPoints: 0,
    blurb: 'Planted. Every check-in gives it a little water.',
  },
  {
    level: 2,
    name: 'Sprout',
    stage: 1,
    minPoints: 15,
    blurb: "It is up. A handful of days of checking in did that.",
  },
  {
    level: 3,
    name: 'Sapling',
    stage: 2,
    minPoints: 32,
    blurb: "Taking root — you have been coming back to it.",
  },
  {
    level: 4,
    name: 'Young Tree',
    stage: 3,
    minPoints: 50,
    blurb: 'Steady enough to take a rough week without noticing.',
  },
  {
    level: 5,
    name: 'Full Tree',
    stage: 4,
    minPoints: 68,
    blurb: 'Settled, with plenty of lighter days in the mix.',
  },
  {
    level: 6,
    name: 'In Blossom',
    stage: 5,
    minPoints: 85,
    blurb: "You have been showing up for a while now, and it shows.",
  },
];

export const MAX_LEVEL = LEVEL_TIERS[LEVEL_TIERS.length - 1]!.level;

export function tierForPoints(points: number): LevelTier {
  let found = LEVEL_TIERS[0]!;
  for (const tier of LEVEL_TIERS) {
    if (points >= tier.minPoints) found = tier;
  }
  return found;
}

/** The tier above `tier`, or null at the top. */
export function nextTier(tier: LevelTier): LevelTier | null {
  return LEVEL_TIERS.find((t) => t.level === tier.level + 1) ?? null;
}

/** 0-1 of the way from the current tier's floor to the next one's. 1 at the top tier. */
export function progressToNext(points: number): number {
  const tier = tierForPoints(points);
  const next = nextTier(tier);
  if (!next) return 1;
  const span = next.minPoints - tier.minPoints;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - tier.minPoints) / span));
}

/** Points still needed for the next tier, or 0 at the top. */
export function pointsToNext(points: number): number {
  const next = nextTier(tierForPoints(points));
  return next ? Math.max(0, next.minPoints - points) : 0;
}

/**
 * What the level is made of, in plain sentences — the card lists these under the tree.
 *
 * A level with no explanation is a slot machine: the only way it can be a reflection rather than a
 * prize is if the person can read off exactly what moved it.
 */
export function levelReasons(stats: LevelStats): string[] {
  const reasons = [
    `Checked in on ${stats.daysLogged} of the last ${stats.windowDays} days`,
  ];
  reasons.push(
    stats.positiveShare == null
      ? 'No check-ins yet to read a feeling from'
      : `${Math.round(stats.positiveShare * 100)}% of them were calm or good`
  );
  if (stats.streak > 0) {
    reasons.push(
      stats.streak === 1 ? 'On a 1-day streak' : `On a ${stats.streak}-day streak`
    );
  }
  return reasons;
}
