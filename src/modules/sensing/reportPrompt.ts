/**
 * Pure helpers for building the AI insights report prompt.
 * No React or SQLite imports, so scripts/selfcheck-report.ts can run this under plain Node.
 */
import type { Mood } from '../../services/db';

export type ReportPeriod = 'daily' | 'weekly';

export interface ReportMoodEntry {
  date: string;
  mood: Mood | null;
  note: string | null;
}

export interface ReportPhq4 {
  total: number;
  severity: string;
}

/**
 * Every field is nullable; null means the device did not measure it, and is sent to the model as "no data", never as zero.
 * The threshold fields are iOS-only floors (iOS reports only that a daily threshold was crossed), kept separate so a lower bound is never passed off as a duration.
 */
export interface ReportUsage {
  sleepOnsetTs: number | null;
  sleepWakeTs: number | null;
  sleepEstimated: boolean;
  /** Real device unlocks. Null on a phone whose collector cannot see them, which is not the same as none. */
  unlockCount: number | null;
  /** Times MoodSense itself was opened, which says nothing about how often the phone was picked up. */
  appOpenCount: number | null;
  glanceCount: number | null;
  longestScreenMs: number | null;
  socialMs: number | null;
  audioVideoMs: number | null;
  callMs: number | null;
  callEstimated: boolean;
  socialThresholdMin: number | null;
  audioVideoThresholdMin: number | null;
  /** Only apps the participant named: an anonymous code tells the model nothing it can write a sentence about. */
  namedApps: { name: string; atLeastMinutes: number }[];
}

/**
 * Where their tree has got to. Passed in rather than described in the prompt because a model told
 * to mention the tree without being told its level will invent one, and a wrong level is worse than
 * no tree: the card is right there on the You tab for them to check.
 */
export interface ReportGrowth {
  level: number;
  maxLevel: number;
  /** The tier's own name — "Sprout", "Young tree", "In blossom". */
  name: string;
  /** Check-ins logged in the level window, which is what grew it. */
  checkinDays: number;
}

/** The anonymous community aggregate, for the "not the only one" note. Null when they have no community set. */
export interface ReportCommunity {
  /** What the community is called where the user chose it, e.g. a country or region. */
  label: string;
  /** Share of nearby participants whose check-ins sat on the heavier side, 0-1. */
  heavierShare: number;
}

export interface ReportData {
  period: ReportPeriod;
  moodEntries: ReportMoodEntry[];
  phq4: ReportPhq4 | null;
  steps: number | null;
  screenEvents: number;
  appOpens: number;
  usage: ReportUsage;
  /** Null when the level has not been computed for this run. */
  growth?: ReportGrowth | null;
  /** Null when there is no community aggregate to speak for. */
  community?: ReportCommunity | null;
}

export interface ReportPromptMessage {
  role: 'system' | 'user';
  content: string;
}

export const REPORT_SYSTEM_PROMPT = `You are a warm, steady presence in MoodSense, a mental-health app — the voice of a close friend who has been paying attention, or of a favorite teacher checking in on a student they care about. You write back to the user about how they have been feeling.

What this is about:
- **Your subject is how they have been — their mood, in their own words.** The check-ins and anything they wrote in a note are the material. Write about the person, not the phone.
- Passive sensing figures (steps, screen use, sleep window, social and audio/video time, call time) are background only. They are there to help you understand a feeling they already told you about — never to be reported back.
- **Do not recite the figures.** Reading someone their own step count, screen time or unlock count is unsettling, not caring: it tells them they are being watched and measured. A friend who had noticed would not say "you took 3,200 steps and unlocked your phone 80 times".
- At most ONE sensing detail may appear in the whole piece, only if it explains something they said about their mood (a late night behind a tired day), and only in soft words — "a short night", "a quiet few days" — never as a number, a total or a comparison.
- If there is no mood check-in and no note, you have nothing to summarize. Say that kindly in a sentence or two and invite them to check in. Do NOT fill the gap with sensing figures.

How to write:
- Talk TO them, as one person to another, in plain second-person English ("you"). Warm, calm, unhurried — never clinical, never chirpy, never a performance review.
- Write flowing prose: 3-5 sentences in one or two short paragraphs.
- NEVER use a list. No bullet points, no dashes starting lines, no numbering, no headings, no bold or any other markdown, no "at a glance" summary block. Just sentences that follow one another, the way a friend would actually say it.
- If what they told you is sparse or mixed, say so gently and stay curious rather than concluding something about them.
- You are NOT a clinician: never diagnose, never label them with a condition, never give medical or medication advice, and never interpret a score clinically. Describe, do not assess.

Leave them encouraged, and mean it:
- Name something they actually did. Checking in at all counts, and on a hard week it counts for more.
- If their tree's level is given, you may use it as the encouragement — it grew out of them coming back and checking in, so it is evidence of their own steadiness, not a reward. Name it the way the app does ("your tree", its tier name) and never scold them for a level, a plateau or a gap.
- If a community figure is given, you may use it once to remind them they are not the only one feeling this way — gently, as company rather than a statistic, and never to minimize what they feel ("plenty of people around you had a heavy week too" is company; "so it is not that bad" is dismissal).
- Close with warmth, or one small kind suggestion — not a plan, not homework.
- If the PHQ-4 score suggests notable distress (moderate or severe), or a note mentions self-harm, suicide, or feeling unsafe, drop the tree and the community entirely, stay close and caring, and encourage them in a sentence to talk with a mental-health professional or a crisis line (for example calling or texting 988 in the US, or a local crisis line via findahelpline.com elsewhere; never guess a number) — as something you would want for a friend, not as a disclaimer.

- A figure that is not listed was not measured. Never say a stat was zero, low, or missing because of something they did.`;

const MOOD_LABELS: Record<Mood, string> = {
  calm: 'Calm',
  good: 'Good',
  stressed: 'Stressed',
  low: 'Low',
  tired: 'Tired',
};

export function moodLabel(mood: Mood | null): string {
  if (mood == null) return 'no check-in';
  return MOOD_LABELS[mood];
}

export function formatMoodEntry(entry: ReportMoodEntry): string {
  const parts = [`${entry.date}: ${moodLabel(entry.mood)}`];
  if (entry.note) parts.push(`note: "${entry.note}"`);
  return parts.join(' — ');
}

export function buildReportUserContent(data: ReportData): string {
  const lines: string[] = [];
  lines.push(data.period === 'daily' ? "Today's data:" : "This week's data (last 7 days):");
  lines.push('');
  lines.push('Mood check-ins:');
  if (data.moodEntries.every((e) => e.mood == null)) {
    lines.push('- No mood check-ins logged.');
  } else {
    for (const entry of data.moodEntries) {
      lines.push(`- ${formatMoodEntry(entry)}`);
    }
  }
  lines.push('');
  lines.push(
    data.phq4
      ? `PHQ-4 wellbeing check: total ${data.phq4.total}/12 (${data.phq4.severity}).`
      : 'PHQ-4 wellbeing check: not taken in this period.'
  );
  lines.push('');
  // Labelled as background, and as not-for-repeating, right where the numbers are: the system
  // prompt says it once, and the figures themselves are the strongest invitation to recite them.
  lines.push('Background context only — do NOT report these back to the user:');
  lines.push(`- Steps: ${data.steps == null ? 'no data' : data.steps}`);
  lines.push(`- Screen-on events: ${data.screenEvents}`);
  lines.push(`- MoodSense opened: ${data.appOpens} times`);
  for (const line of formatUsageLines(data.usage)) lines.push(line);
  if (data.growth) {
    lines.push('');
    lines.push(
      `Their tree: level ${data.growth.level} of ${data.growth.maxLevel}, "${data.growth.name}", grown from ${data.growth.checkinDays} ${
        data.growth.checkinDays === 1 ? 'day' : 'days'
      } of checking in.`
    );
  }
  if (data.community) {
    lines.push('');
    lines.push(
      `Their community (${data.community.label}): ${Math.round(
        data.community.heavierShare * 100
      )}% of nearby people also checked in on the heavier side this week.`
    );
  }
  lines.push('');
  lines.push(
    data.period === 'daily'
      ? 'Write back to them about how today felt, as flowing prose — no lists, no figures.'
      : 'Write back to them about how this week felt, as flowing prose — no lists, no figures. You may touch on one pattern across the days.'
  );
  return lines.join('\n');
}

function durationWords(ms: number | null): string | null {
  if (ms == null) return null;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return 'under a minute';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function clockWords(ts: number | null): string | null {
  if (ts == null) return null;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Fields the device cannot measure are left out rather than sent as "no data".
 * Five absences in a row reads to the model like a person who did nothing, not a phone that sees nothing.
 */
export function formatUsageLines(usage: ReportUsage): string[] {
  const lines: string[] = [];
  const onset = clockWords(usage.sleepOnsetTs);
  const wake = clockWords(usage.sleepWakeTs);
  if (onset && wake) {
    const qualifier = usage.sleepEstimated ? ' (estimated from phone inactivity)' : '';
    lines.push(`- Slept ${onset} to ${wake}${qualifier}`);
  }
  if (usage.unlockCount != null) lines.push(`- Phone unlocked: ${usage.unlockCount} times`);
  if (usage.appOpenCount != null) lines.push(`- Opened MoodSense: ${usage.appOpenCount} times`);
  if (usage.glanceCount != null) {
    lines.push(`- Brief glances at the screen (under 15s): ${usage.glanceCount}`);
  }
  for (const app of usage.namedApps) {
    lines.push(`- ${app.name}: at least ${app.atLeastMinutes} minutes`);
  }
  const longest = durationWords(usage.longestScreenMs);
  if (longest) lines.push(`- Longest single screen session: ${longest}`);
  const social = durationWords(usage.socialMs);
  if (social) lines.push(`- Time in social apps: ${social}`);
  else if (usage.socialThresholdMin != null) {
    lines.push(`- Time in social apps: at least ${usage.socialThresholdMin} minutes (iPhone reports only that a daily threshold was passed, never a total)`);
  }
  const av = durationWords(usage.audioVideoMs);
  if (av) lines.push(`- Time in audio/video apps: ${av}`);
  else if (usage.audioVideoThresholdMin != null) {
    lines.push(`- Time in audio/video apps: at least ${usage.audioVideoThresholdMin} minutes (same threshold-only limit)`);
  }
  const call = durationWords(usage.callMs);
  if (call) {
    lines.push(
      usage.callEstimated
        ? `- Time on calls: ${call} (estimated from time in the phone app)`
        : `- Time on calls: ${call} (measured, but only calls made while the app was running)`
    );
  }
  return lines;
}

export function buildReportPrompt(data: ReportData): ReportPromptMessage[] {
  return [
    { role: 'system', content: REPORT_SYSTEM_PROMPT },
    { role: 'user', content: buildReportUserContent(data) },
  ];
}

/**
 * Last line of defense for the no-lists rule: the model often drifts back to markdown headers and bullets, and the card renders plain text.
 * Bullets are joined into sentences, paragraph breaks are kept, and heading/emphasis markup is unwrapped.
 */
export function toProse(text: string): string {
  const paragraphs: string[][] = [[]];
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine
      .replace(/^\s*(?:[-*\u2022\u00b7]|\d+[.)])\s+/, '')
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, '$1')
      .trim();
    if (line === '') {
      if (paragraphs[paragraphs.length - 1].length > 0) paragraphs.push([]);
      continue;
    }
    paragraphs[paragraphs.length - 1].push(/[.!?:,;]$/.test(line) ? line : `${line}.`);
  }
  return paragraphs
    .filter((p) => p.length > 0)
    .map((p) => p.join(' '))
    .join('\n\n')
    .trim();
}

export function buildDemoReport(
  data: ReportData,
  pick: <T>(options: T[]) => T = randomPick
): string {
  const logged = data.moodEntries.filter((e) => e.mood != null);
  const periodWords = data.period === 'daily' ? 'today' : 'this week';

  if (logged.length === 0) {
    return pick([
      `There is not much to go on for ${periodWords} yet — no check-ins have been logged. Whenever you are ready, tapping a feeling on the home screen takes a second, and it is what gives this summary something to say.`,
      `${periodWords === 'today' ? 'Today' : 'This week'} is still a blank page here: no check-ins logged so far. No pressure either way, but if you do feel like marking how you are doing, the home screen is one tap.`,
    ]);
  }

  const sentences: string[] = [];

  const counts = new Map<Mood, number>();
  for (const entry of logged) {
    counts.set(entry.mood!, (counts.get(entry.mood!) ?? 0) + 1);
  }
  let dominant: Mood = logged[0]!.mood!;
  for (const [mood, n] of counts) {
    if (n > (counts.get(dominant) ?? 0)) dominant = mood;
  }
  const latest = logged[logged.length - 1]!.mood!;

  sentences.push(
    pick([
      `Thanks for checking in with yourself ${periodWords} — that is worth something on its own.`,
      `Good on you for checking in ${periodWords} — noticing how you are doing is the part most people skip.`,
    ])
  );

  sentences.push(MOOD_SENTENCE[dominant]);
  if (data.period === 'weekly' && latest !== dominant) {
    sentences.push(
      `The most recent one was ${MOOD_LABELS[latest].toLowerCase()}, so it has not all been one note.`
    );
  }

  const highlight = pickSoftHighlight(data, pick);
  if (highlight) sentences.push(highlight);

  // Not random and not softened: a moderate or severe score must always be mentioned. No score
  // or severity label is quoted — same "describe, don't assess" rule as the AI system prompt —
  // and the crisis line is named generically rather than a US-only number.
  if (data.phq4 && (data.phq4.severity === 'Moderate' || data.phq4.severity === 'Severe')) {
    sentences.push(
      'Things have felt heavier than usual lately, and that is worth taking seriously — talking it through with a mental-health professional, or reaching out to a local crisis line if things feel heavy right now, is the kind of thing a friend would want for you.'
    );
  }

  sentences.push(
    pick([
      'Be kind to yourself with whatever comes next.',
      'Nothing to fix here — just keep noticing.',
      'Whatever the next few days look like, you do not have to get them perfect.',
      'One small good thing today is plenty.',
    ])
  );

  return sentences.join(' ');
}

const MOOD_SENTENCE: Record<Mood, string> = {
  calm: 'Calm came up most often, which is a good place to be sitting.',
  good: 'Good showed up more than anything else, and that is worth letting land.',
  stressed:
    'Stressed came up most often, and that is a lot to carry without saying so out loud.',
  low: 'Low was the one that kept coming back, and heavy stretches like that are real.',
  tired: 'Tired came up most often, and running on empty deserves some rest, not more pushing.',
};

/**
 * At most one soft, non-numeric sensing detail — same rule as the AI system prompt above.
 * Only sleep length is used, and only as a qualitative note ("a short night"), never a clock
 * time or a duration figure; everything else (steps, unlocks, social/audio-video time) is
 * background the user never needs quoted back to them.
 */
function pickSoftHighlight(data: ReportData, pick: <T>(options: T[]) => T): string | null {
  const onset = data.usage.sleepOnsetTs;
  const wake = data.usage.sleepWakeTs;
  if (onset == null || wake == null) return null;
  const hours = (wake - onset) / 3_600_000;
  if (hours < 6) {
    return pick([
      'It looks like last night was a short one.',
      'You were running on a shorter night’s sleep.',
    ]);
  }
  if (hours >= 8) {
    return pick([
      'Looks like you got a good, full night’s sleep.',
      'A solid night’s rest is a nice thing to have behind you.',
    ]);
  }
  return null;
}

function randomPick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)]!;
}
