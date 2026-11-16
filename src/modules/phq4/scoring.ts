/** Pure PHQ-4 scoring with no React Native or Expo imports, so it runs in plain Node (see scripts/selfcheck-phq4.ts). */

export type Phq4Severity = 'none' | 'mild' | 'moderate' | 'severe';

export interface Phq4Score {
  /** Sum of all four items, 0–12. */
  total: number;
  /** GAD-2 subscale (items 1+2), 0–6. */
  anxiety: number;
  /** PHQ-2 subscale (items 3+4), 0–6. */
  depression: number;
  anxietyPositive: boolean;
  depressionPositive: boolean;
  /** 0–2 none, 3–5 mild, 6–8 moderate, 9–12 severe. */
  severity: Phq4Severity;
}

export function scorePhq4(
  answers: [number, number, number, number]
): Phq4Score {
  const [q1, q2, q3, q4] = answers;
  const anxiety = q1 + q2;
  const depression = q3 + q4;
  const total = anxiety + depression;

  let severity: Phq4Severity;
  if (total <= 2) severity = 'none';
  else if (total <= 5) severity = 'mild';
  else if (total <= 8) severity = 'moderate';
  else severity = 'severe';

  return {
    total,
    anxiety,
    depression,
    anxietyPositive: anxiety >= 3,
    depressionPositive: depression >= 3,
    severity,
  };
}
