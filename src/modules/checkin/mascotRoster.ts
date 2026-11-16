/**
 * Who is on duty, and when. The twelve characters are split into a day and a night shift, so the
 * mascot drawn in the check-in row matches the light outside the window; an 11pm check-in used to
 * be able to land on a sun.
 * No other imports, so Node-only scripts and the self-checks can use it too — the drawings live in
 * MoodMascot.tsx, which is the only place react-native-svg is needed.
 */

export type Mascot =
  | 'sunny'
  | 'bao'
  | 'peachy'
  | 'puff'
  | 'sprout'
  | 'bun'
  | 'luna'
  | 'mochi'
  | 'honey'
  | 'boba'
  | 'pengu'
  | 'hedgie';

/** Bright, outdoor characters: the sun, things that grow, a bun that is still warm. */
export const DAY_SHIFT: readonly Mascot[] = ['sunny', 'bao', 'peachy', 'puff', 'sprout', 'bun'];

/** Cosy, dim characters: the moon, the two animals that are actually nocturnal, an evening drink. */
export const NIGHT_SHIFT: readonly Mascot[] = ['luna', 'mochi', 'honey', 'boba', 'pengu', 'hedgie'];

/** The whole cast, derived from the shifts so the two can never drift apart. */
export const MASCOT_ORDER: readonly Mascot[] = [...DAY_SHIFT, ...NIGHT_SHIFT];

export const MASCOT_NAMES: Record<Mascot, string> = {
  sunny: 'Sunny',
  bao: 'Bao',
  peachy: 'Peachy',
  puff: 'Puff',
  sprout: 'Sprout',
  bun: 'Bun',
  luna: 'Luna',
  mochi: 'Mochi',
  honey: 'Honey',
  boba: 'Boba',
  pengu: 'Pengu',
  hedgie: 'Hedgie',
};

export type Shift = 'day' | 'night';

/** The day shift starts at 06:00 and hands over at 18:00, both local time. */
export const DAY_SHIFT_START_HOUR = 6;
export const NIGHT_SHIFT_START_HOUR = 18;

export function shiftFor(date: Date = new Date()): Shift {
  const hour = date.getHours();
  return hour >= DAY_SHIFT_START_HOUR && hour < NIGHT_SHIFT_START_HOUR ? 'day' : 'night';
}

/**
 * The day of month the current shift started on. The small hours belong to the night that began
 * yesterday evening, so one night keeps one character instead of swapping at midnight.
 */
function shiftStartDayOfMonth(date: Date): number {
  if (date.getHours() >= DAY_SHIFT_START_HOUR) return date.getDate();
  const previous = new Date(date);
  // setDate(0) rolls back into the previous month, so month ends need no special case.
  previous.setDate(previous.getDate() - 1);
  return previous.getDate();
}

/** The character on duty: the shift picks the roster, the date picks who from it. */
export function mascotOnDuty(date: Date = new Date()): Mascot {
  const roster = shiftFor(date) === 'day' ? DAY_SHIFT : NIGHT_SHIFT;
  return roster[(shiftStartDayOfMonth(date) - 1) % roster.length]!;
}

/** Milliseconds until the next handover, for re-rendering the row when a shift ends mid-session. */
export function msUntilNextShift(date: Date = new Date()): number {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  const hour = date.getHours();
  if (hour < DAY_SHIFT_START_HOUR) {
    next.setHours(DAY_SHIFT_START_HOUR);
  } else if (hour < NIGHT_SHIFT_START_HOUR) {
    next.setHours(NIGHT_SHIFT_START_HOUR);
  } else {
    next.setHours(DAY_SHIFT_START_HOUR);
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - date.getTime();
}
