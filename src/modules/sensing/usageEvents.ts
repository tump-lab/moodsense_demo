/**
 * Turns Android's raw UsageStatsManager event stream (from the patched react-native-app-usage `getUsageEvents`) into screen, lock, per-app session and call-length signals.
 * "Call length" is really time with the dialer/in-call UI in the foreground, so it misses in-app calls and counts dialling; every record carries `estimated: true`.
 */
import { categorizeApp, type AppCategory } from './appCategories';
import type { UsageEvent as PackageUsageEvent } from './backgroundUsage';
import type { ScreenEvent } from './screenSessions';

export type RawUsageEventType =
  | 'activity_resumed'
  | 'activity_paused'
  | 'screen_interactive'
  | 'screen_non_interactive'
  | 'keyguard_shown'
  | 'keyguard_hidden'
  | 'foreground_service_start'
  | 'foreground_service_stop';

export interface RawUsageEvent {
  type: RawUsageEventType;
  ts: number;
  packageName?: string;
}

/**
 * keyguard_hidden is the unlock and keyguard_shown is the lock.
 * The names read backwards, and swapping them would silently invert every unlock count.
 */
const SCREEN_EVENT_MAP: Partial<Record<RawUsageEventType, ScreenEvent['type']>> = {
  screen_interactive: 'screen_on',
  screen_non_interactive: 'screen_off',
  keyguard_hidden: 'screen_unlock',
  keyguard_shown: 'screen_lock',
};

export function toScreenEvents(events: RawUsageEvent[]): ScreenEvent[] {
  const out: ScreenEvent[] = [];
  for (const e of events) {
    const type = SCREEN_EVENT_MAP[e.type];
    if (type) out.push({ type, ts: e.ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export interface AppSession {
  packageName: string;
  category: AppCategory;
  startTs: number;
  endTs: number;
  durationMs: number;
}

/**
 * State is per package, not one global "current app": Android interleaves leaving one app and entering the next.
 * A session still open at the end of the window is left out and gets paired on the next poll.
 */
export function deriveAppSessions(events: RawUsageEvent[]): AppSession[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const open = new Map<string, number>();
  const sessions: AppSession[] = [];

  for (const e of sorted) {
    const pkg = e.packageName;
    if (!pkg) continue;
    if (e.type === 'activity_resumed') {
      if (!open.has(pkg)) open.set(pkg, e.ts);
    } else if (e.type === 'activity_paused') {
      const startTs = open.get(pkg);
      if (startTs == null) continue;
      open.delete(pkg);
      if (e.ts < startTs) continue;
      sessions.push({
        packageName: pkg,
        category: categorizeApp(pkg),
        startTs,
        endTs: e.ts,
        durationMs: e.ts - startTs,
      });
    }
  }

  return sessions;
}

export interface CallSession {
  startTs: number;
  endTs: number;
  durationMs: number;
  packageName: string;
  estimated: true;
  method: 'incall_ui_foreground';
}

/**
 * Shorter than this is almost never a call: opening the dialer, checking a missed call, hanging up on a robocall.
 */
export const MIN_CALL_MS = 10_000;

export function deriveCallSessions(
  events: RawUsageEvent[],
  minCallMs: number = MIN_CALL_MS
): CallSession[] {
  return deriveAppSessions(events)
    .filter((s) => s.category === 'call' && s.durationMs >= minCallMs)
    .map((s) => ({
      startTs: s.startTs,
      endTs: s.endTs,
      durationMs: s.durationMs,
      packageName: s.packageName,
      estimated: true as const,
      method: 'incall_ui_foreground' as const,
    }));
}

export function toPackageEvents(events: RawUsageEvent[]): PackageUsageEvent[] {
  const out: PackageUsageEvent[] = [];
  for (const e of events) {
    if (!e.packageName) continue;
    if (
      e.type === 'activity_resumed' ||
      e.type === 'activity_paused' ||
      e.type === 'foreground_service_start' ||
      e.type === 'foreground_service_stop'
    ) {
      out.push({ packageName: e.packageName, type: e.type, ts: e.ts });
    }
  }
  return out;
}

export function sumSessionsByCategory(sessions: AppSession[]): Record<AppCategory, number> {
  const totals: Record<AppCategory, number> = { social: 0, audioVideo: 0, call: 0, other: 0 };
  for (const s of sessions) totals[s.category] += s.durationMs;
  return totals;
}
