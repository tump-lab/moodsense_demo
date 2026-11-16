/**
 * Single source of truth for the five mood categories, their order and labels; no screen should hardcode its own copy.
 * No other imports, so Node-only scripts and the self-checks can use it too.
 */
import type { Mood } from '../../services/db';

export const MOOD_ORDER: readonly Mood[] = ['calm', 'good', 'stressed', 'low', 'tired'];

export const MOOD_LABELS: Record<Mood, string> = {
  calm: 'Calm',
  good: 'Good',
  stressed: 'Stressed',
  low: 'Low',
  tired: 'Tired',
};

/**
 * Coarse positive vs negative grouping, defined once so every tally agrees.
 * Calm is ambiguous; it counts as positive because a non-distressed check-in reads closer to "up" than "down", not because Calm and Good are the same feeling.
 */
export const MOOD_VALENCE: Record<Mood, 'positive' | 'negative'> = {
  calm: 'positive',
  good: 'positive',
  stressed: 'negative',
  low: 'negative',
  tired: 'negative',
};

export function isPositiveMood(mood: Mood): boolean {
  return MOOD_VALENCE[mood] === 'positive';
}

export function isNegativeMood(mood: Mood): boolean {
  return MOOD_VALENCE[mood] === 'negative';
}
