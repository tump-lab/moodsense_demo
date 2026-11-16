/**
 * The "what is behind this mood" tags offered right after a check-in. One shared set for every mood,
 * since the same parts of life lift us or weigh on us; only the question changes. Five plus Other,
 * so the sheet fits on one screen. No React imports, so scripts can use it.
 */
import type { Mood } from '../../services/db';
import { isPositiveMood } from './moods';

export interface MoodReason {
  id: string;
  label: string;
}

/** Free text goes in the check-in's `note`; this id only marks that Other was picked. */
export const OTHER_REASON_ID = 'other';

export const MOOD_REASONS: readonly MoodReason[] = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'work_study', label: 'Work or study' },
  { id: 'people', label: 'People I care about' },
  { id: 'body', label: 'How my body feels' },
  { id: 'me_time', label: 'Time for myself' },
];

/**
 * Ids from the first version, which had separate positive and negative tags. Check-ins saved then
 * are read as the shared tag they fold into; there is no replacement for Achievement or good news.
 */
const LEGACY_REASONS: Record<string, string> = {
  lack_of_sleep: 'sleep',
  good_sleep: 'sleep',
  work_pressure: 'work_study',
  study_pressure: 'work_study',
  progress_work_study: 'work_study',
  relationships_family: 'people',
  time_with_people: 'people',
  health: 'body',
  exercise_rest: 'me_time',
  achievement_news: OTHER_REASON_ID,
};

export function reasonsForMood(_mood: Mood): readonly MoodReason[] {
  return MOOD_REASONS;
}

export function reasonPrompt(mood: Mood): string {
  return isPositiveMood(mood)
    ? 'What made you feel good today?'
    : 'What might be contributing to how you feel?';
}

const LABELS = new Map(MOOD_REASONS.map((r) => [r.id, r.label] as const));

export function reasonLabel(id: string): string {
  return id === OTHER_REASON_ID ? 'Other' : (LABELS.get(id) ?? id);
}

/**
 * Stored as a JSON array in `checkins.reasons`; anything unreadable is treated as no reasons.
 * Old ids come back as their shared tag, without duplicates.
 */
export function parseReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const ids = v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => LEGACY_REASONS[x] ?? x);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}
