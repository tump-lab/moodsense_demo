/**
 * Turns a peer group's schedule into a calendar event: the next meeting, repeating as listed. Times
 * are the organizer's wall clock, so a group at 6 pm in Lafayette stays 6 pm there across DST and
 * lands correctly for someone whose phone is in another zone.
 *
 * No React Native imports, so scripts/selfcheck-help.ts can run it under plain Node.
 */
import type { GroupMeeting, PeerGroup } from './helpResources';

/** Offset of `zone` from UTC at that instant, in minutes. */
function zoneOffsetMin(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The instant a wall-clock time in `zone` happens. `month` is 1-12. */
export function wallTimeToDate(y: number, month: number, d: number, h: number, min: number, zone: string): Date {
  const guess = Date.UTC(y, month - 1, d, h, min);
  // Twice, because the first guess can land on the other side of a DST change.
  const first = guess - zoneOffsetMin(new Date(guess), zone) * 60000;
  return new Date(guess - zoneOffsetMin(new Date(first), zone) * 60000);
}

/** The next meeting that has not started yet, or null if the schedule never matches. */
export function nextOccurrence(meets: GroupMeeting, zone: string, from: Date): Date | null {
  const local = new Date(from.getTime() + zoneOffsetMin(from, zone) * 60000);
  for (let i = 0; i < 70; i += 1) {
    // Date.UTC normalizes a day past the end of the month.
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i));
    if (day.getUTCDay() !== meets.weekday) continue;
    const nth = Math.ceil(day.getUTCDate() / 7);
    if (meets.weeks && !meets.weeks.includes(nth)) continue;
    const at = wallTimeToDate(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      meets.start.h,
      meets.start.m,
      zone
    );
    if (at.getTime() > from.getTime()) return at;
  }
  return null;
}

/**
 * From our 0 = Sunday to what expo-calendar's iOS code reads: Monday = 1 through Sunday = 7. Its
 * published DayOfTheWeek enum says Sunday = 1, and following that books every repeat a day late.
 */
export function iosRecurrenceWeekday(weekday: number): number {
  return weekday === 0 ? 7 : weekday;
}

export interface GroupCalendarEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  timeZone: string;
  location: string;
  notes: string;
  url: string;
  recurrence: { weekly?: number; nthWeekdays?: { weekday: number; week: number }[] };
}

export function calendarEventFor(
  group: PeerGroup,
  organizer: { name: string; phone: string; url: string; timeZone: string },
  from: Date
): GroupCalendarEvent | null {
  if (!group.meets) return null;
  const startDate = nextOccurrence(group.meets, organizer.timeZone, from);
  if (!startDate) return null;
  const { weekday, weeks, durationMin } = group.meets;
  return {
    title: group.name,
    startDate,
    endDate: new Date(startDate.getTime() + durationMin * 60000),
    timeZone: organizer.timeZone,
    location:
      group.format === 'Online'
        ? `Online, link from ${organizer.name}`
        : (group.location ?? organizer.name),
    notes: `${group.format} group run by ${organizer.name}. Call ${organizer.phone} to confirm your place. Details: ${organizer.url}`,
    url: organizer.url,
    recurrence: weeks
      ? { nthWeekdays: weeks.map((week) => ({ weekday, week })) }
      : { weekly: weekday },
  };
}

/**
 * Opens the phone's own new-event sheet, which needs no calendar permission on iOS 17+ and never
 * reads the calendar on any version. Loaded on tap so a build without the native module fails here, not at launch.
 * Returns whether the person kept the event. Android's sheet takes no repeat rule and cannot report
 * a cancel, so there it books the next meeting and counts as kept.
 */
export async function addGroupToCalendar(event: GroupCalendarEvent, isIos: boolean): Promise<boolean> {
  const Calendar = await import('expo-calendar/legacy');
  const { recurrence, ...details } = event;
  const recurrenceRule = !isIos
    ? undefined
    : recurrence.nthWeekdays
      ? {
          frequency: Calendar.Frequency.MONTHLY,
          daysOfTheWeek: recurrence.nthWeekdays.map((n) => ({
            dayOfTheWeek: iosRecurrenceWeekday(n.weekday),
            weekNumber: n.week,
          })),
        }
      : {
          frequency: Calendar.Frequency.WEEKLY,
          daysOfTheWeek: [{ dayOfTheWeek: iosRecurrenceWeekday(recurrence.weekly ?? 0) }],
        };
  const eventData = { ...details, recurrenceRule };
  const result = await Calendar.createEventInCalendarAsync(eventData).catch(async () => {
    // Before iOS 17 the sheet itself needs calendar permission. Asked only now, on the tap.
    await Calendar.requestCalendarPermissionsAsync();
    return Calendar.createEventInCalendarAsync(eventData);
  });
  return result.action !== 'canceled';
}
