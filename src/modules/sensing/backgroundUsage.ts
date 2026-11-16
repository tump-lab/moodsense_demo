/**
 * Background-vs-foreground app usage: the event shape plus the pure logic that turns UsageStatsManager events into background spans.
 * Android only; the events come from collectors.ts' startUsageEventPolling through the patched react-native-app-usage.
 */
import { categorizeApp, type AppCategory } from './appCategories';

export type UsageEventType =
  | 'activity_resumed'
  | 'activity_paused'
  | 'foreground_service_start' // e.g. audio playback, a call
  | 'foreground_service_stop';

export interface UsageEvent {
  packageName: string;
  type: UsageEventType;
  ts: number;
}

export interface BackgroundUsageSpan {
  packageName: string;
  category: AppCategory;
  startTs: number;
  endTs: number;
  durationMs: number;
}

const DEFAULT_MIN_DURATION_MS = 5_000;

/**
 * A span is the time between a foreground-service start and its stop for a package that is not on screen at the time, above `minDurationMs` to drop short blips.
 * Events are sorted by ts first so out-of-order delivery cannot make negative spans.
 */
export function deriveBackgroundUsageSpans(
  events: UsageEvent[],
  minDurationMs: number = DEFAULT_MIN_DURATION_MS,
): BackgroundUsageSpan[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const spans: BackgroundUsageSpan[] = [];
  const openServiceStart = new Map<string, number>();
  const foregroundPackages = new Set<string>();

  for (const e of sorted) {
    switch (e.type) {
      case 'activity_resumed':
        foregroundPackages.add(e.packageName);
        break;
      case 'activity_paused':
        foregroundPackages.delete(e.packageName);
        break;
      case 'foreground_service_start':
        openServiceStart.set(e.packageName, e.ts);
        break;
      case 'foreground_service_stop': {
        const start = openServiceStart.get(e.packageName);
        openServiceStart.delete(e.packageName);
        if (start == null || e.ts < start) break;
        if (foregroundPackages.has(e.packageName)) break; // on-screen, not background
        const durationMs = e.ts - start;
        if (durationMs < minDurationMs) break;
        spans.push({
          packageName: e.packageName,
          category: categorizeApp(e.packageName),
          startTs: start,
          endTs: e.ts,
          durationMs,
        });
        break;
      }
    }
  }

  return spans;
}

export function aggregateBackgroundDurationsByCategory(
  spans: BackgroundUsageSpan[],
): Record<AppCategory, number> {
  const totals: Record<AppCategory, number> = { social: 0, audioVideo: 0, call: 0, other: 0 };
  for (const s of spans) totals[s.category] += s.durationMs;
  return totals;
}
