/**
 * Turns fragmented raw sleep samples (HealthKit segments, Health Connect stages) into one record per night: onset, wake, and total asleep time.
 * Pure logic kept out of collectors.ts so scripts/selfcheck-sensing.ts can test it.
 */

export type SleepSegmentState = 'asleep' | 'awake' | 'inbed' | 'unknown';

export interface RawSleepSegment {
  startTs: number;
  endTs: number;
  state: SleepSegmentState;
}

export interface SleepNight {
  date: string;
  onsetTs: number;
  wakeTs: number;
  totalAsleepMs: number;
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Nights are keyed by their start date (YYYY-MM-DD) with a noon-to-noon boundary: a segment starting before local noon belongs to the previous night.
 * A midnight boundary would split one 11pm-7am sleep into two nights.
 */
export function nightDateForTs(ts: number): string {
  const d = new Date(ts);
  if (d.getHours() < 12) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    return localDateStr(prev);
  }
  return localDateStr(d);
}

/**
 * Only ASLEEP segments count; awake and in-bed time never feed onset, wake or duration.
 * A night with no asleep segments produces no record.
 */
export function deriveSleepNights(segments: RawSleepSegment[]): SleepNight[] {
  const byNight = new Map<string, RawSleepSegment[]>();
  for (const seg of segments) {
    if (seg.state !== 'asleep') continue;
    if (seg.endTs <= seg.startTs) continue;
    const night = nightDateForTs(seg.startTs);
    const list = byNight.get(night);
    if (list) list.push(seg);
    else byNight.set(night, [seg]);
  }

  const nights: SleepNight[] = [];
  for (const [date, segs] of byNight) {
    let onsetTs = Infinity;
    let wakeTs = -Infinity;
    let totalAsleepMs = 0;
    for (const seg of segs) {
      onsetTs = Math.min(onsetTs, seg.startTs);
      wakeTs = Math.max(wakeTs, seg.endTs);
      totalAsleepMs += seg.endTs - seg.startTs;
    }
    nights.push({ date, onsetTs, wakeTs, totalAsleepMs });
  }
  return nights.sort((a, b) => a.date.localeCompare(b.date));
}

/** iOS 16+ reports stage values like 'ASLEEP_CORE' through the same field as the older 'ASLEEP', so a prefix check counts both as asleep. */
export function mapHealthKitSleepValue(value: string | null | undefined): SleepSegmentState {
  if (!value) return 'unknown';
  const v = value.toUpperCase();
  if (v.startsWith('ASLEEP')) return 'asleep';
  if (v === 'AWAKE') return 'awake';
  if (v === 'INBED') return 'inbed';
  return 'unknown';
}

/** Health Connect stage constants, checked against react-native-health-connect's runtime SleepStageType export: UNKNOWN=0, AWAKE=1, SLEEPING=2, OUT_OF_BED=3, LIGHT=4, DEEP=5, REM=6. */
const HC_SLEEP_STAGE_AWAKE = 1;
const HC_SLEEP_STAGE_SLEEPING = 2;
const HC_SLEEP_STAGE_OUT_OF_BED = 3;
const HC_SLEEP_STAGE_LIGHT = 4;
const HC_SLEEP_STAGE_DEEP = 5;
const HC_SLEEP_STAGE_REM = 6;

export function mapHealthConnectSleepStage(stage: number): SleepSegmentState {
  switch (stage) {
    case HC_SLEEP_STAGE_SLEEPING:
    case HC_SLEEP_STAGE_LIGHT:
    case HC_SLEEP_STAGE_DEEP:
    case HC_SLEEP_STAGE_REM:
      return 'asleep';
    case HC_SLEEP_STAGE_AWAKE:
      return 'awake';
    case HC_SLEEP_STAGE_OUT_OF_BED:
      return 'inbed';
    default:
      return 'unknown';
  }
}
