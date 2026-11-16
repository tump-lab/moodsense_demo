/**
 * PHQ-4 instrument content (Kroenke, Spitzer, Williams & Löwe, 2009).
 * Items 1–2 form the anxiety subscale (GAD-2); items 3–4 the depression
 * subscale (PHQ-2).
 */

export const PHQ4_STEM =
  'Over the last 2 weeks, how often have you been bothered by...';

export interface Phq4Option {
  label: string;
  value: 0 | 1 | 2 | 3;
}

export const PHQ4_OPTIONS: readonly Phq4Option[] = [
  { label: 'Not at all', value: 0 },
  { label: 'Several days', value: 1 },
  { label: 'More than half the days', value: 2 },
  { label: 'Nearly every day', value: 3 },
] as const;

export const PHQ4_QUESTIONS: readonly string[] = [
  'Feeling nervous, anxious or on edge',
  'Not being able to stop or control worrying',
  'Feeling down, depressed or hopeless',
  'Little interest or pleasure in doing things',
] as const;
