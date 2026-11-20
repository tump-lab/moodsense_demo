/**
 * Pure math for the Home "how you've been" card: the self-reported line, the daily-rhythm line, and the gentle guess at tomorrow.
 * No React Native or Expo imports, so scripts/selfcheck-wellbeing-trend.ts can run it under plain Node.
 *
 * Both lines share one 0-1 axis where higher is a lighter day. The self-reported line is a majority vote across
 * whatever the participant told us that day; the rhythm line is a small per-person logistic regression on passive
 * signals, so it has a value on every day, including tomorrow.
 */
import type { Mood } from '../../services/db';
import { isPositiveMood } from './moods';

export const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar days ending on `end`, oldest first. Built from local dates, not ts arithmetic, so DST days are not skipped. */
export function dayKeysEnding(end: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(localDateKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)));
  }
  return out;
}

export function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return localDateKey(new Date(y, m - 1, d + 1));
}

/**
 * 0-1 share of the local day that has already passed. Today's passive signals are running totals
 * that only cover this much of a day, and reading them as if the day were over is what used to make
 * the rhythm line meaningless until the small hours — see featureVector.
 */
export function dayProgress(now: Date = new Date()): number {
  const secondsIntoDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return Math.min(1, Math.max(0, secondsIntoDay / 86400));
}

export const DAY_SLOTS = ['morning', 'midday', 'evening'] as const;
export type DaySlot = (typeof DAY_SLOTS)[number];

/**
 * Which third of the day it is. New sensing rows already move today's point whenever they land, so
 * this is the floor rather than the mechanism: the slot is part of the cache fingerprint (see
 * wellbeingTrendData), so the line is rebuilt at least three times a day even on a quiet device.
 */
export function daySlot(now: Date = new Date()): DaySlot {
  const h = now.getHours();
  if (h < 11) return 'morning';
  if (h < 17) return 'midday';
  return 'evening';
}

// ---------------------------------------------------------------------------
// Self-report sources
// ---------------------------------------------------------------------------

/** Share of the day's check-ins that were Calm or Good. */
export function moodSourceScore(moods: Mood[]): number | null {
  if (moods.length === 0) return null;
  return moods.filter(isPositiveMood).length / moods.length;
}

/**
 * Banded by PHQ-4 severity rather than linear in the total, so the vote flips exactly where moderate begins (total 6),
 * the same cut the Mood Check result screen uses.
 */
export function phq4SourceScore(total: number): number {
  if (total <= 2) return 0.9;
  if (total <= 5) return 0.65;
  if (total <= 8) return 0.35;
  return 0.1;
}

const POSITIVE_WORDS = [
  'happy', 'glad', 'calm', 'relaxed', 'peaceful', 'grateful', 'thankful', 'excited', 'hopeful', 'proud',
  'content', 'joy', 'joyful', 'good', 'great', 'better', 'fine', 'okay', 'rested', 'energized', 'loved',
  'confident', 'cheerful', 'relieved', 'motivated', 'fun', 'enjoyed', 'love', 'nice', 'wonderful',
];

const NEGATIVE_WORDS = [
  'sad', 'down', 'low', 'depressed', 'anxious', 'anxiety', 'worried', 'worry', 'stressed', 'stress',
  'overwhelmed', 'tired', 'exhausted', 'lonely', 'alone', 'angry', 'upset', 'frustrated', 'scared',
  'afraid', 'nervous', 'hopeless', 'empty', 'numb', 'awful', 'terrible', 'bad', 'worse', 'cry', 'crying',
  'hurt', 'panic', 'drained', 'miserable', 'irritated', 'restless', 'burnout', 'burned',
];

const POSITIVE_SET: ReadonlySet<string> = new Set(POSITIVE_WORDS);
const NEGATIVE_SET: ReadonlySet<string> = new Set(NEGATIVE_WORDS);
const NEGATORS: ReadonlySet<string> = new Set(['not', 'no', 'never', 'hardly', "do not", "did not", "is not", "was not", "cannot", 'cant', 'dont', 'didnt', 'isnt', 'wasnt']);

export interface ToneCounts {
  positive: number;
  negative: number;
}

/**
 * Counts emotion words in what the participant wrote to the companion, flipping a word preceded by a negator within
 * two tokens ("not happy" counts as negative). A deliberately small lexicon: it only has to tell a heavy message from
 * a light one, and a miss is fine because a message with no emotion words abstains rather than voting.
 */
export function countToneWords(text: string): ToneCounts {
  const tokens = text.toLowerCase().replace(/[’]/g, "'").match(/[a-z']+/g) ?? [];
  let positive = 0;
  let negative = 0;
  tokens.forEach((tok, i) => {
    const isPos = POSITIVE_SET.has(tok);
    const isNeg = NEGATIVE_SET.has(tok);
    if (!isPos && !isNeg) return;
    const negated = NEGATORS.has(tokens[i - 1] ?? '') || NEGATORS.has(tokens[i - 2] ?? '');
    if (isPos !== negated) positive += 1;
    else negative += 1;
  });
  return { positive, negative };
}

/** Null, not 0.5, when nothing emotional was said: an ordinary chat about the weather is no vote at all. */
export function conversationSourceScore(messages: string[]): number | null {
  let positive = 0;
  let negative = 0;
  for (const m of messages) {
    const c = countToneWords(m);
    positive += c.positive;
    negative += c.negative;
  }
  const total = positive + negative;
  return total === 0 ? null : positive / total;
}

export interface DaySelfReport {
  /** 1 lighter, 0 heavier, null when nobody voted or the vote and the scores tie exactly. */
  label: 0 | 1 | null;
  /** Where the dot sits: the mean score of the side that won the vote. Null when there was nothing to vote with. */
  value: number | null;
  sources: number;
}

/**
 * Each available source votes lighter (> 0.5) or heavier (< 0.5); exactly 0.5 abstains.
 * Majority wins; a tied vote falls back to the mean of every source's score.
 */
export function voteSelfReport(scores: Array<number | null>): DaySelfReport {
  const present = scores.filter((s): s is number => s != null && Number.isFinite(s));
  if (present.length === 0) return { label: null, value: null, sources: 0 };
  const up = present.filter((s) => s > 0.5);
  const down = present.filter((s) => s < 0.5);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  if (up.length > down.length) return { label: 1, value: mean(up), sources: present.length };
  if (down.length > up.length) return { label: 0, value: mean(down), sources: present.length };
  const all = mean(present);
  return { label: all > 0.5 ? 1 : all < 0.5 ? 0 : null, value: all, sources: present.length };
}

// ---------------------------------------------------------------------------
// Passive features and the per-person model
// ---------------------------------------------------------------------------

/** One day's passive signals; any of them may be missing. */
export interface DayPhysical {
  steps: number | null;
  sleepHours: number | null;
  screenHours: number | null;
  unlocks: number | null;
  restingHr: number | null;
  /**
   * Minutes the OS classified as walking, running or cycling. Driving, standing still and
   * low-confidence time are deliberately left out: this is meant to be time spent moving under
   * your own power, which is the part the literature ties to mood.
   */
  activeMinutes: number | null;
  /**
   * True when `screenHours` is a lower bound rather than a duration. iOS reports only that a daily
   * threshold was crossed, so the best it can say is "at least 7h", in 30-minute steps. The model
   * reads the number either way — a floor is a far better estimate of the day than the 0 that
   * stands for "an ordinary day" — but anything showing it to a participant, or pooling it across
   * platforms, has to know it is not the same measurement as Android's millisecond total.
   */
  screenHoursIsFloor?: boolean;
  /**
   * True when `restingHr` is the quiet end of the day's own heart-rate samples rather than a
   * resting figure the health platform computed. Same spirit as `screenHoursIsFloor`: the model
   * reads the number either way, but anything showing it to a participant should not call an
   * estimate a measurement.
   */
  restingHrIsEstimated?: boolean;
}

export const EMPTY_PHYSICAL: DayPhysical = {
  steps: null,
  sleepHours: null,
  screenHours: null,
  unlocks: null,
  restingHr: null,
  activeMinutes: null,
};

export const FEATURE_NAMES = [
  'sleepShortfall',
  'steps',
  'screenHours',
  'unlocks',
  'restingHr',
  'activeMinutes',
  'yesterday',
] as const;

/**
 * Starting weights before the person has any history, in the direction the sensing literature points: short sleep,
 * long screen time and a raised resting heart rate lean heavier, movement and a light yesterday lean lighter.
 * Training pulls toward the person's own pattern but is anchored here, so three labelled days cannot swing it wildly.
 */
export const PRIOR_WEIGHTS: readonly number[] = [-0.5, 0.35, -0.25, -0.15, -0.2, 0.3, 0.8];
export const PRIOR_BIAS = 0.4;

export interface Baselines {
  restingHr: number | null;
}

function meanOf(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
}

/** Heart rate varies a lot between people, so it is read against the person's own average, not a fixed norm. */
export function personalBaselines(days: DayPhysical[]): Baselines {
  return {
    restingHr: meanOf(days.map((d) => d.restingHr)),
  };
}

/** Floor on the divisor behind a running total, so the first minutes after midnight cannot divide by ~0. */
const MIN_PROJECTION_SHARE = 0.05;

/**
 * Fixed reference scales (not fit to the data) so the prior weights keep meaning the same thing.
 * A missing signal becomes 0, which is "an ordinary day" on every feature, so the model always produces a value.
 * `yesterday` is the previous day's self-report label centred on 0, or 0 when there wasn't one.
 *
 * `progress` is the share of the day the signals cover — 1 for every finished day, and the share
 * elapsed so far for today. Steps, screen time and unlocks are running totals, so they are read at
 * the *rate* they are accumulating rather than against a whole day's reference, and then weighted
 * by how much of the day they have actually seen. Both halves matter: without the rate, today reads
 * as a sedentary day all morning; without the weight, four hundred steps at 6am would project to a
 * disastrous day on almost no evidence. Sleep and resting HR are left alone — a night is finished
 * by the time the day starts, and the other is an average, not a total.
 */
export function featureVector(
  p: DayPhysical,
  base: Baselines,
  yesterday: 0 | 1 | null,
  progress: number = 1
): number[] {
  const share = Math.min(1, Math.max(0, progress));
  const rate = (total: number) => total / Math.max(share, MIN_PROJECTION_SHARE);
  const seen = (z: number) => z * share;

  const sleepShortfall = p.sleepHours == null ? 0 : Math.max(0, 7 - p.sleepHours) / 1.5;
  const steps =
    p.steps == null ? 0 : seen((Math.log1p(rate(p.steps)) - Math.log1p(6000)) / 0.8);
  const screen = p.screenHours == null ? 0 : seen((rate(p.screenHours) - 4) / 2);
  const unlocks = p.unlocks == null ? 0 : seen((rate(p.unlocks) - 60) / 40);
  const rhr =
    p.restingHr == null || base.restingHr == null ? 0 : (p.restingHr - base.restingHr) / 5;
  // A running total like steps, so it is read as a rate and weighted by how much of the day it has
  // seen. 30 minutes is the reference day; the scale is wide because most days have very few.
  const active =
    p.activeMinutes == null ? 0 : seen((rate(p.activeMinutes) - 30) / 30);
  const lag = yesterday == null ? 0 : yesterday === 1 ? 1 : -1;
  return [sleepShortfall, steps, screen, unlocks, rhr, active, lag].map((v) =>
    Math.max(-3, Math.min(3, v))
  );
}

export interface LogisticModel {
  weights: number[];
  bias: number;
  trainedOn: number;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function predict(model: LogisticModel, x: number[]): number {
  let z = model.bias;
  for (let i = 0; i < x.length; i++) z += (model.weights[i] ?? 0) * (x[i] ?? 0);
  return sigmoid(z);
}

/**
 * MAP logistic regression with a Gaussian prior centred on PRIOR_WEIGHTS, by plain batch gradient descent.
 * A week to a few months of days and seven features is a few thousand multiply-adds, so this runs in well under a
 * millisecond and needs no library. With no labelled days it returns the prior unchanged.
 */
export function trainLogistic(
  xs: number[][],
  ys: Array<0 | 1>,
  opts: { priorStrength?: number; iterations?: number; learningRate?: number } = {}
): LogisticModel {
  const lambda = opts.priorStrength ?? 1;
  const iters = opts.iterations ?? 300;
  const lr = opts.learningRate ?? 0.1;
  const weights = [...PRIOR_WEIGHTS];
  let bias = PRIOR_BIAS;
  const n = xs.length;
  if (n === 0) return { weights, bias, trainedOn: 0 };

  for (let it = 0; it < iters; it++) {
    const gw = weights.map((w, j) => lambda * (w - PRIOR_WEIGHTS[j]!));
    let gb = lambda * (bias - PRIOR_BIAS);
    for (let i = 0; i < n; i++) {
      const err = predict({ weights, bias, trainedOn: 0 }, xs[i]!) - ys[i]!;
      for (let j = 0; j < weights.length; j++) gw[j]! += err * (xs[i]![j] ?? 0);
      gb += err;
    }
    for (let j = 0; j < weights.length; j++) weights[j]! -= (lr * gw[j]!) / Math.max(1, n);
    bias -= (lr * gb) / Math.max(1, n);
  }
  return { weights, bias, trainedOn: n };
}

// ---------------------------------------------------------------------------
// Assembling the card's series
// ---------------------------------------------------------------------------

export interface DayInputs {
  date: string;
  moods: Mood[];
  /** PHQ-4 totals taken that day; usually zero or one. */
  phq4Totals: number[];
  /** What the participant wrote (or said, transcribed) to the companion that day. */
  messages: string[];
  physical: DayPhysical;
}

/**
 * What one point's rhythm value was read from, carried on the point so the card can show the
 * numbers behind a reading instead of only the word it came out as. These are the raw signals, not
 * the feature vector: a participant asking "why does it think that" wants hours and steps, not
 * centred and clipped z-scores.
 */
export interface TrendBasis {
  /** The day's own passive signals. For tomorrow, the average of the finished days it borrowed. */
  physical: DayPhysical;
  /** For tomorrow, how many finished days were averaged into `physical`; 0 on a day of its own. */
  borrowedDays: number;
  /** The previous day's self-report, which is the model's `yesterday` feature, or null if there wasn't one. */
  yesterday: 0 | 1 | null;
  /** Share of the day the signals cover: 1 for a finished day, the part elapsed so far for today. */
  progress: number;
  /**
   * The one or two recorded signals that moved this reading most, strongest first, already ranked
   * by what they actually contributed to the model rather than by how big the raw number looks.
   * Empty when nothing was recorded. This is what the card shows; `physical` stays for anything
   * that needs the numbers themselves.
   */
  drivers: BasisDriver[];
}

/** One signal's pull on a reading, in words rather than numbers. */
export interface BasisDriver {
  /** The signal, named the way a person would say it: 'steps', 'sleep', 'screen time'. */
  signal: string;
  /** Which way it pulled the reading. */
  towards: 'lighter' | 'heavier';
  /** How that day's value compares to this person's ordinary: 'few', 'a lot of', 'little'… */
  qualifier: string;
}

export interface TrendPoint {
  date: string;
  /** Self-reported value, 0-1, or null to leave a gap. */
  felt: number | null;
  /** The rhythm line, 0-1. Always present. */
  rhythm: number;
  /** True only for tomorrow's point. */
  ahead: boolean;
  /** True for today while the day is still running, so the card can say the value is a day-so-far. */
  partial: boolean;
  /** The signals this point's `rhythm` was read from. */
  basis: TrendBasis;
}

export interface TrendSeries {
  points: TrendPoint[];
  /** Tomorrow's value, also the last point. */
  tomorrow: number;
  /** How many past days the person's own history taught the model, for the "still learning" note. */
  learnedFromDays: number;
  /** True when any self-report exists in the shown window. */
  hasFelt: boolean;
  /**
   * True when this account has ever shared a day, anywhere in the history the series was built
   * from — not just inside the window on screen.
   *
   * The card needs the two apart. `hasFelt` answers "is there a solid line to draw here", which a
   * returning participant can fail on a quiet week; this answers "is there anything to chart at
   * all". A brand-new account has no self-reports and no passive history either, so the rhythm line
   * it would be shown is the untrained prior drawn across a week it was not here for, and the
   * hollow dot past it is a prediction of a person the model has never met. That read as the app
   * claiming to know something about them on day one. Below it, the card shows an empty state
   * instead; the dashed line keeps its real job of carrying a participant with history across the
   * days they did not check in.
   */
  everFelt: boolean;
  /**
   * How many days this account has shared, across the whole history. The card holds back the
   * tomorrow guess until there are a few, and labels it an early guess for the first week.
   */
  feltDays: number;
  /** When this series was built, so the card can show how current today's reading is. */
  builtAt: number;
}

export function selfReportForDay(d: DayInputs): DaySelfReport {
  const phq4 = d.phq4Totals.length === 0 ? null : phq4SourceScore(d.phq4Totals[d.phq4Totals.length - 1]!);
  return voteSelfReport([moodSourceScore(d.moods), phq4, conversationSourceScore(d.messages)]);
}

/** How many finished days tomorrow's guess averages. Named because the card tells the reader the number. */
export const TOMORROW_WINDOW = 3;

/** Tomorrow's signals are not in yet, so it borrows the average of the last `days` days, ignoring missing values. */
export function recentPhysical(days: DayPhysical[], window = TOMORROW_WINDOW): DayPhysical {
  const tail = days.slice(-window);
  return {
    steps: meanOf(tail.map((d) => d.steps)),
    sleepHours: meanOf(tail.map((d) => d.sleepHours)),
    screenHours: meanOf(tail.map((d) => d.screenHours)),
    unlocks: meanOf(tail.map((d) => d.unlocks)),
    activeMinutes: meanOf(tail.map((d) => d.activeMinutes)),
    restingHr: meanOf(tail.map((d) => d.restingHr)),
  };
}

/**
 * Which recorded signals actually moved a reading, and which way.
 *
 * Ranked by |weight x feature|, which is each signal's own contribution to the logit, so the order
 * is the model's opinion rather than ours. Only signals the day actually recorded are eligible: a
 * missing one is centred to 0 by featureVector and contributes nothing, so it could never rank, but
 * being explicit keeps a future non-zero fill-in from quietly becoming an explanation.
 *
 * `yesterday` is deliberately not a candidate. It is usually the strongest term in the model, and a
 * card that answered "why does it read heavy today" with "because yesterday was heavy" would be
 * both true and useless.
 */
const DRIVER_SIGNALS: ReadonlyArray<{
  index: number;
  signal: string;
  recorded: (p: DayPhysical) => boolean;
  /** Said of a value that pushed the reading *heavier*, then of one that pushed it lighter. */
  words: readonly [string, string];
}> = [
  { index: 0, signal: 'sleep', recorded: (p) => p.sleepHours != null, words: ['short', 'enough'] },
  { index: 1, signal: 'steps', recorded: (p) => p.steps != null, words: ['few', 'plenty of'] },
  { index: 2, signal: 'screen time', recorded: (p) => p.screenHours != null, words: ['a lot of', 'little'] },
  { index: 3, signal: 'pick-ups', recorded: (p) => p.unlocks != null, words: ['a lot of', 'few'] },
  { index: 4, signal: 'resting heart rate', recorded: (p) => p.restingHr != null, words: ['a raised', 'a settled'] },
  { index: 5, signal: 'time moving', recorded: (p) => p.activeMinutes != null, words: ['little', 'plenty of'] },
];

/** How many signals the bubble names. Two is a sentence; three is a list. */
export const MAX_DRIVERS = 2;

/** Below this the term is noise, and naming it would invent a reason the model did not have. */
const MIN_CONTRIBUTION = 0.05;

export function driversFor(
  physical: DayPhysical,
  features: number[],
  model: LogisticModel
): BasisDriver[] {
  const scored = DRIVER_SIGNALS.filter((d) => d.recorded(physical))
    .map((d) => {
      // Positive pushes the reading towards lighter, matching the sign convention on PRIOR_WEIGHTS.
      const contribution = (model.weights[d.index] ?? 0) * (features[d.index] ?? 0);
      return { d, contribution };
    })
    .filter((x) => Math.abs(x.contribution) >= MIN_CONTRIBUTION)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, MAX_DRIVERS);

  return scored.map(({ d, contribution }) => ({
    signal: d.signal,
    towards: contribution >= 0 ? 'lighter' : 'heavier',
    qualifier: contribution >= 0 ? d.words[1] : d.words[0],
  }));
}

export interface TrendBuildOptions {
  /**
   * Share of today that has already passed, 0-1, where today is the last day of `history`.
   * Defaults to 1, which treats every day as finished — what a backfill or a self-check wants.
   */
  todayProgress?: number;
  /** Stamped onto the series as `builtAt`; injectable so the self-checks stay deterministic. */
  now?: number;
}

/**
 * `history` is every day available for training, oldest first, ending today; the card shows the last `showDays` of it
 * plus tomorrow. Training uses the whole history so a one-week view still benefits from older days.
 */
export function buildTrendSeries(
  history: DayInputs[],
  showDays: number,
  opts: TrendBuildOptions = {}
): TrendSeries {
  const todayProgress = Math.min(1, Math.max(0, opts.todayProgress ?? 1));
  const partialToday = todayProgress < 1;
  const lastIndex = history.length - 1;

  const physical = history.map((d) => d.physical);
  const base = personalBaselines(physical);
  const labels = history.map(selfReportForDay);

  const xs: number[][] = [];
  const ys: Array<0 | 1> = [];
  const features = history.map((d, i) =>
    featureVector(
      d.physical,
      base,
      labels[i - 1]?.label ?? null,
      i === lastIndex ? todayProgress : 1
    )
  );
  features.forEach((x, i) => {
    // Today is still happening. Its part-day signals are fine to *draw* — that is the whole point of
    // a rhythm line you can read before bedtime — but fitting on them would teach the model that a
    // half-walked day is what a lighter day looks like.
    if (partialToday && i === lastIndex) return;
    const y = labels[i]!.label;
    if (y != null) {
      xs.push(x);
      ys.push(y);
    }
  });
  const model = trainLogistic(xs, ys);

  const start = Math.max(0, history.length - showDays);
  const points: TrendPoint[] = [];
  for (let i = start; i < history.length; i++) {
    points.push({
      date: history[i]!.date,
      felt: labels[i]!.value,
      rhythm: predict(model, features[i]!),
      ahead: false,
      partial: partialToday && i === lastIndex,
      basis: {
        physical: history[i]!.physical,
        borrowedDays: 0,
        yesterday: labels[i - 1]?.label ?? null,
        progress: i === lastIndex ? todayProgress : 1,
        drivers: driversFor(history[i]!.physical, features[i]!, model),
      },
    });
  }

  const lastLabel = [...labels].reverse().find((l) => l.label != null)?.label ?? null;
  // Tomorrow borrows the last few *finished* days: averaging in a day that is only a third over
  // would hand tomorrow a third of a day's steps.
  const finished = partialToday ? physical.slice(0, lastIndex) : physical;
  const borrowed = finished.length > 0 ? finished : physical;
  const borrowedPhysical = recentPhysical(borrowed);
  const tomorrow = predict(model, featureVector(borrowedPhysical, base, lastLabel));
  const lastDate = history[history.length - 1]?.date;
  if (lastDate) {
    points.push({
      date: nextDayKey(lastDate),
      felt: null,
      rhythm: tomorrow,
      ahead: true,
      partial: false,
      basis: {
        physical: borrowedPhysical,
        borrowedDays: Math.min(TOMORROW_WINDOW, borrowed.length),
        yesterday: lastLabel,
        progress: 1,
        drivers: driversFor(
          borrowedPhysical,
          featureVector(borrowedPhysical, base, lastLabel),
          model
        ),
      },
    });
  }

  return {
    points,
    tomorrow,
    learnedFromDays: model.trainedOn,
    hasFelt: points.some((p) => p.felt != null),
    // Read from the whole history, not from `points`, so narrowing the range cannot turn an
    // established account back into a new one. sliceSeries carries it through unchanged.
    everFelt: labels.some((l) => l.value != null),
    feltDays: labels.filter((l) => l.value != null).length,
    builtAt: opts.now ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Words. The card is the companion talking, so it describes days, never scores or tracking.
// ---------------------------------------------------------------------------

export function companionLine(series: TrendSeries, name: string): string {
  if (!(series.everFelt ?? series.hasFelt)) {
    return `Hi, I'm ${name}. I'll keep your days here.`;
  }
  if (!series.hasFelt) {
    return `I will keep how you are doing right here. — ${name}`;
  }
  if (series.tomorrow >= 0.6) {
    return `Tomorrow might feel a little lighter. — ${name}`;
  }
  if (series.tomorrow <= 0.4) {
    return `Tomorrow may be heavier. We will go gently. — ${name}`;
  }
  return `However tomorrow goes, I am here. — ${name}`;
}

export function dayFeelWord(value: number): string {
  if (value >= 0.65) return 'lighter';
  if (value >= 0.4) return 'in between';
  return 'heavier';
}

export function trendSummary(series: TrendSeries): string {
  const felt = series.points.filter((p) => p.felt != null);
  const tomorrow = `Tomorrow may feel ${dayFeelWord(series.tomorrow)}.`;
  if (felt.length === 0) return `No days shared yet. ${tomorrow}`;
  const latest = felt[felt.length - 1]!;
  return `You shared ${felt.length} ${felt.length === 1 ? 'day' : 'days'}; most recently it felt ${dayFeelWord(latest.felt!)}. ${tomorrow}`;
}

export interface BasisRow {
  label: string;
  value: string;
}

/**
 * The day's signals as a reader sees them, in their own units, every row present whether or not the
 * signal is. A missing one says so rather than being dropped: "not recorded" is the answer to why a
 * reading looks thin, so hiding the row would hide the explanation.
 */
export function basisRows(basis: TrendBasis): BasisRow[] {
  const p = basis.physical;
  const show = (v: number | null, format: (n: number) => string) =>
    v == null ? 'not recorded' : format(v);
  return [
    { label: 'Sleep', value: show(p.sleepHours, (n) => `${n.toFixed(1)} hours`) },
    { label: 'Steps', value: show(p.steps, (n) => Math.round(n).toLocaleString('en-US')) },
    {
      label: 'Time moving',
      value: show(p.activeMinutes, (n) =>
        n >= 60 ? `${Math.floor(n / 60)} hours ${Math.round(n % 60)} minutes` : `${Math.round(n)} minutes`
      ),
    },
    {
      label: 'Screen time',
      // "at least" is the whole difference between what iOS measured and what Android did; printing
      // a bare 7.0 h here would quietly turn a threshold crossing into a duration.
      value: show(p.screenHours, (n) =>
        p.screenHoursIsFloor ? `at least ${n.toFixed(1)} hours` : `${n.toFixed(1)} hours`
      ),
    },
    { label: 'Unlocks', value: show(p.unlocks, (n) => String(Math.round(n))) },
    {
      label: 'Resting heart rate',
      value: show(p.restingHr, (n) =>
        p.restingHrIsEstimated ? `around ${Math.round(n)} beats per minute` : `${Math.round(n)} beats per minute`
      ),
    },
    {
      label: 'The day before',
      value:
        basis.yesterday == null
          ? 'not shared'
          : basis.yesterday === 1
            ? 'felt lighter'
            : 'felt heavier',
    },
  ];
}

/**
 * The whole explanation, in one sentence, for the bubble a long-press opens.
 *
 * Deliberately not the numbers. Someone holding a point is asking why the line sits where it does,
 * and a column of readings makes them do the correlating themselves — worse, it shows rows that
 * were never recorded, so the commonest thing the card said was "not recorded" six times over. This
 * names only what was recorded, and only the one or two signals that actually moved the reading.
 */
export function basisDigest(point: TrendPoint): string {
  const { drivers, borrowedDays, progress } = point.basis;
  const reading = point.rhythm >= 0.5 ? 'Reads lighter' : 'Reads heavier';

  const when = point.ahead
    ? borrowedDays === 0
      ? 'A guess, with no days behind it yet.'
      : `A guess from your last ${borrowedDays} ${borrowedDays === 1 ? 'day' : 'days'}.`
    : point.partial
      ? `So far today (${Math.round(progress * 100)}% in).`
      : null;

  if (drivers.length === 0) {
    const nothing = point.ahead
      ? 'Nothing recorded yet to go on.'
      : 'Nothing was recorded this day, so this is only how you said you felt.';
    return when && !point.ahead ? `${when} ${nothing}` : nothing;
  }

  const phrases = drivers.map((d) => `${d.qualifier} ${d.signal}`);
  const because =
    phrases.length === 1 ? phrases[0]! : `${phrases[0]} and ${phrases[1]}`;
  const sentence = `${reading}, mostly ${because}.`;
  return when ? `${when} ${sentence}` : sentence;
}

/** Narrows a series built for the longest range down to the last `days` past days plus tomorrow, so one cached build serves every range. */
export function sliceSeries(series: TrendSeries, days: number): TrendSeries {
  const past = series.points.filter((p) => !p.ahead).slice(-days);
  const ahead = series.points.filter((p) => p.ahead);
  const points = [...past, ...ahead];
  return { ...series, points, hasFelt: points.some((p) => p.felt != null) };
}
