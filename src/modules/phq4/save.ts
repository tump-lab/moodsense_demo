/**
 * The one place a PHQ-4 result is written. Both surfaces that can produce one — the four-question
 * Mood Check screen and a prefill confirmed inside the companion chat — go through here, so the
 * local row, the Firestore mirror, the analytics event and the "done" signal can never drift apart.
 */
import { addDoc, collection } from 'firebase/firestore';
import { exec, type EntrySource } from '../../services/db';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';
import { logEvent } from '../../services/logging';
import { scorePhq4, type Phq4Score } from './scoring';
import { countElevatedResultsBefore, usePhq4CompletionSignal } from './history';
import {
  shouldShowSupportResource,
  SUPPORT_RESOURCE_POLICY,
} from './supportResources';
import { lastSupportShownAt, markSupportShown } from './supportShownState';

export type Phq4Answers = [number, number, number, number];

export interface SavedPhq4Result {
  ts: number;
  answers: Phq4Answers;
  score: Phq4Score;
  source: EntrySource;
  /**
   * Whether this result has earned the 988 card (supportResources.ts). Decided once, here, so the
   * Mood Check screen, the companion result card and the companion's own wording cannot disagree
   * about it, and so the cooldown is written exactly once per result.
   */
  showSupport: boolean;
}

export async function savePhq4Result(
  answers: Phq4Answers,
  source: EntrySource = 'manual'
): Promise<SavedPhq4Result> {
  const score = scorePhq4(answers);
  const ts = Date.now();

  await exec(
    `INSERT INTO phq4_results (ts, q1, q2, q3, q4, total, anxiety, depression, uid, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ts,
      answers[0],
      answers[1],
      answers[2],
      answers[3],
      score.total,
      score.anxiety,
      score.depression,
      getActiveUid(),
      source,
    ]
  );

  const showSupport = await resolveSupportResource(score, ts);

  mirrorResult(ts, answers, score, source);
  void logEvent('phq4_completed', {
    total: score.total,
    anxiety: score.anxiety,
    depression: score.depression,
    severity: score.severity,
    source,
    showSupport,
  });
  usePhq4CompletionSignal.getState().markCompleted();

  return { ts, answers, score, source, showSupport };
}

/**
 * Applies the policy to this result and, when the card is shown, starts its cooldown. The row for
 * this result is already in the table by the time this runs, hence the `ts` cutoff in
 * countElevatedResultsBefore — a score must not count itself twice.
 */
async function resolveSupportResource(
  score: Phq4Score,
  ts: number
): Promise<boolean> {
  const needsHistory = score.severity === 'moderate';
  const [priorElevated, lastShownAt] = needsHistory
    ? await Promise.all([
        countElevatedResultsBefore(
          ts,
          SUPPORT_RESOURCE_POLICY.corroborationDays,
          SUPPORT_RESOURCE_POLICY.elevatedTotal
        ),
        lastSupportShownAt(),
      ])
    : [0, null];

  const show = shouldShowSupportResource({
    severity: score.severity,
    priorElevated,
    lastShownAt,
    now: ts,
  });
  // Severe shows unconditionally but still starts the clock, so a severe check today followed by a
  // moderate one tomorrow does not put the card up twice in two days.
  if (show) await markSupportShown(ts);
  return show;
}

function mirrorResult(
  ts: number,
  answers: Phq4Answers,
  score: Phq4Score,
  source: EntrySource
): void {
  const db = getDb();
  if (!db) return;
  void (async () => {
    try {
      const user = await ensureSignedIn();
      if (!user) return;
      await addDoc(collection(db, 'users', user.uid, 'phq4_results'), {
        ts,
        q1: answers[0],
        q2: answers[1],
        q3: answers[2],
        q4: answers[3],
        total: score.total,
        anxiety: score.anxiety,
        depression: score.depression,
        severity: score.severity,
        source,
      });
    } catch {
      // Best effort: local SQLite is the source of truth.
    }
  })();
}
