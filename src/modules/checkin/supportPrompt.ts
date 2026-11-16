/**
 * Decides when a long stretch of low check-ins should gently point someone towards
 * professional support, and holds the copy that prompt shows.
 *
 * No React Native / Expo imports, so scripts/selfcheck-support-prompt.ts can run the
 * whole policy under plain Node. `Mood` is a type-only import, so expo-sqlite is never
 * loaded at runtime.
 */
import type { Mood } from '../../services/db';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calendar day keys ending on `end`, oldest first, in the same local `YYYY-MM-DD` shape
 * `store.ts` writes. Built by walking local calendar days rather than subtracting
 * milliseconds, so the 23- and 25-hour days around a DST change are not skipped or
 * doubled. `streak.ts` keeps its own date helpers for the same reason; if those ever get
 * collected into one place, this should move with them.
 */
function dayKeysEnding(end: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    keys.push(`${d.getFullYear()}-${m}-${day}`);
  }
  return keys;
}

export const SUPPORT_PROMPT_POLICY = {
  /** Calendar days looked at, ending today. */
  windowDays: 7,
  /** Low days in that window needed before the prompt appears. */
  minLowDays: 5,
  /**
   * Days in the window that must carry at least one check-in.
   * With the thresholds above this is already implied — every low day is also a
   * reported day — but it is kept explicit so that lowering `minLowDays` later cannot
   * quietly let the prompt fire off one or two entries.
   */
  minReportedDays: 4,
  /**
   * Quiet period after the prompt was last shown. A nudge repeated every launch stops
   * being gentle, and someone having a hard month would otherwise meet it daily.
   */
  cooldownDays: 14,
} as const;

export interface DatedMood {
  date: string;
  mood: Mood;
}

export interface LowStretch {
  windowDays: number;
  /** Days in the window with at least one Low check-in. */
  lowDays: number;
  /** Days in the window with any check-in at all. */
  reportedDays: number;
  /** True when the stretch is long enough to offer support, before the cooldown applies. */
  qualifies: boolean;
}

/**
 * A day counts as low when *any* check-in that day was Low.
 *
 * This deliberately differs from the one-mood-per-day rule used for streaks and the
 * Community aggregate, where `streak.ts` takes the latest check-in by ts. Those describe
 * what a day was; this decides whether to offer help, so it leans towards noticing
 * rather than letting a better evening average a low morning away. The 5-of-7 threshold
 * is what keeps that sensitivity from firing on a single rough afternoon.
 *
 * Dates are the stored local `YYYY-MM-DD` keys compared as strings, so nothing is
 * recomputed against the current device's timezone.
 */
export function summariseLowStretch(entries: DatedMood[], today: Date): LowStretch {
  const window = new Set(dayKeysEnding(today, SUPPORT_PROMPT_POLICY.windowDays));
  const reported = new Set<string>();
  const low = new Set<string>();

  for (const entry of entries) {
    if (!window.has(entry.date)) continue;
    reported.add(entry.date);
    if (entry.mood === 'low') low.add(entry.date);
  }

  return {
    windowDays: SUPPORT_PROMPT_POLICY.windowDays,
    lowDays: low.size,
    reportedDays: reported.size,
    qualifies:
      low.size >= SUPPORT_PROMPT_POLICY.minLowDays &&
      reported.size >= SUPPORT_PROMPT_POLICY.minReportedDays,
  };
}

export interface SupportPromptInput {
  entries: DatedMood[];
  today: Date;
  /** Epoch ms the prompt was last shown, or null if it never has been. */
  lastShownAt: number | null;
  now: number;
}

/**
 * A `lastShownAt` in the future (a clock that moved backwards) holds the prompt back
 * rather than releasing it, which is the quieter way to be wrong.
 */
export function shouldOfferSupport(input: SupportPromptInput): boolean {
  const { entries, today, lastShownAt, now } = input;
  if (!summariseLowStretch(entries, today).qualifies) return false;
  if (lastShownAt == null) return true;
  return now - lastShownAt >= SUPPORT_PROMPT_POLICY.cooldownDays * DAY_MS;
}

/**
 * Kept as data rather than inline JSX so a localization pass can swap it without
 * touching the component, the same way phq4/supportResources.ts does.
 *
 * Tone rules this copy follows, which edits should preserve:
 *  - It never diagnoses. legalText.ts promises the app does not diagnose or treat, so
 *    the prompt names the pattern in the participant's own check-ins and stops there.
 *  - Professional care leads and the crisis line is offered as the any-time option, not the
 *    headline, because a low week is not the same thing as an acute crisis.
 *  - It never implies the study is watching and will step in; participant onboarding
 *    tells people not to wait for anyone from the study.
 *  - Declining is phrased as "Not right now", which leaves the door open.
 */
export const SUPPORT_PROMPT_COPY = {
  title: 'Checking in on you',
  /** `crisisLine` is the region-aware sentence from getCrisisResource().inlineLine. */
  body: (crisisLine: string) => [
    "Your check-ins have shown mostly low days this past week. That is a heavy stretch, and you do not have to get through it alone.",
    `Talking with a doctor, counselor, or therapist can make a real difference. And if you would like to talk with someone right now, support is free, confidential, and open day or night. ${crisisLine}`,
  ],
  disclaimer:
    "MoodSense cannot diagnose anything — this is just a nudge based on your own check-ins.",
  dismiss: 'Not right now',
} as const;
