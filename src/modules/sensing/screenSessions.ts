/**
 * Pure logic that turns a list of screen on/off and lock/unlock events into sessions and a day summary.
 * The two event pairs stay separate because waking the screen to read the time is not the same as unlocking the phone.
 */

export type ScreenEventType = 'screen_on' | 'screen_off' | 'screen_unlock' | 'screen_lock';

const SESSION_START: ReadonlySet<ScreenEventType> = new Set<ScreenEventType>([
  'screen_on',
  'screen_unlock',
]);
const SESSION_END: ReadonlySet<ScreenEventType> = new Set<ScreenEventType>([
  'screen_off',
  'screen_lock',
]);

export function isSessionStart(type: ScreenEventType): boolean {
  return SESSION_START.has(type);
}

export function isSessionEnd(type: ScreenEventType): boolean {
  return SESSION_END.has(type);
}

export interface ScreenEvent {
  type: ScreenEventType;
  ts: number;
}

export interface ScreenSession {
  startTs: number;
  endTs: number;
  durationMs: number;
  /** True when the session began with an unlock rather than a bare wake; false when the source can't tell them apart. */
  unlocked: boolean;
}

/**
 * Events are sorted first; a second wake replaces the open session's start (an unlock after a wake keeps the start and only marks it unlocked), and an end with no open session is dropped.
 * A still-open trailing session is not included.
 */
export function deriveScreenSessions(events: ScreenEvent[]): ScreenSession[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const sessions: ScreenSession[] = [];
  let openStart: number | null = null;
  let openUnlocked = false;

  for (const e of sorted) {
    if (SESSION_START.has(e.type)) {
      if (openStart != null && e.type === 'screen_unlock') {
        openUnlocked = true;
        continue;
      }
      openStart = e.ts;
      openUnlocked = e.type === 'screen_unlock';
    } else if (SESSION_END.has(e.type) && openStart != null) {
      if (e.ts >= openStart) {
        sessions.push({
          startTs: openStart,
          endTs: e.ts,
          durationMs: e.ts - openStart,
          unlocked: openUnlocked,
        });
      }
      openStart = null;
      openUnlocked = false;
    }
  }

  return sessions;
}

export function totalScreenOnMs(sessions: ScreenSession[]): number {
  return sessions.reduce((sum, s) => sum + s.durationMs, 0);
}

/** A session at or under this is a glance, such as checking the time or a notification preview. 15 seconds is long enough to read a lock screen and too short for real use. */
export const GLANCE_MAX_MS = 15_000;

export interface ScreenSummary {
  sessionCount: number;
  totalMs: number;
  glanceCount: number;
  glanceMs: number;
  useCount: number;
  useMs: number;
  longestMs: number;
  unlockedCount: number;
}

export function summarizeScreenSessions(
  sessions: ScreenSession[],
  glanceMaxMs: number = GLANCE_MAX_MS
): ScreenSummary {
  const summary: ScreenSummary = {
    sessionCount: sessions.length,
    totalMs: 0,
    glanceCount: 0,
    glanceMs: 0,
    useCount: 0,
    useMs: 0,
    longestMs: 0,
    unlockedCount: 0,
  };
  for (const s of sessions) {
    summary.totalMs += s.durationMs;
    if (s.durationMs > summary.longestMs) summary.longestMs = s.durationMs;
    if (s.unlocked) summary.unlockedCount += 1;
    if (s.durationMs <= glanceMaxMs) {
      summary.glanceCount += 1;
      summary.glanceMs += s.durationMs;
    } else {
      summary.useCount += 1;
      summary.useMs += s.durationMs;
    }
  }
  return summary;
}

/** Returns null when the stream has no lock/unlock events at all, since a source that cannot see unlocks must not read as zero unlocks. */
export function countUnlocks(events: ScreenEvent[]): number | null {
  let sawLockVocabulary = false;
  let unlocks = 0;
  for (const e of events) {
    if (e.type === 'screen_unlock') {
      sawLockVocabulary = true;
      unlocks += 1;
    } else if (e.type === 'screen_lock') {
      sawLockVocabulary = true;
    }
  }
  return sawLockVocabulary ? unlocks : null;
}
