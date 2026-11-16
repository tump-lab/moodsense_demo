/**
 * Builds the one-line community summary prompt. It never sees individual check-ins, only the
 * aggregate bucket counts already on screen.
 */
import type { Mood } from '../../services/db';
import type { MoodBucket } from './aggregate';

export type UserMoodValence = 'positive' | 'negative' | 'none';

export interface CommunitySummaryData {
  buckets: MoodBucket[];
  userValence: UserMoodValence;
}

export interface CommunitySummaryPromptMessage {
  role: 'system' | 'user';
  content: string;
}

export function moodValence(mood: Mood | null): UserMoodValence {
  if (mood == null) return 'none';
  return mood === 'calm' || mood === 'good' ? 'positive' : 'negative';
}

export const COMMUNITY_SUMMARY_SYSTEM_PROMPT = `You are MoodSense's community companion in a mental-health app. You are given an anonymous breakdown of how many people in the user's chosen community logged each of four mood categories today (Calm, Good, Stressed, Low), plus whether the user's own most recent check-in today was upbeat or hard. Write ONE short, warm message for the user — at most two short sentences — optionally with one gentle, low-effort suggestion (for example a short walk, stepping outside, or reaching out to someone).
Safety rules — follow all of these:
- You are NOT a clinician: never diagnose, never label anyone with a condition, never give medical or medication advice.
- Never minimize what anyone is feeling, and never say things like "everyone else is fine, cheer up" or imply the user should feel differently than they do.
- Never pressure the user to feel or act a certain way — any suggestion is an optional invitation, never an instruction.
- If the counts skew toward Stressed/Low, the right tone is solidarity and companionship (e.g. "you are not the only one having a hard day"), never forced positivity that talks over that.
- Only state what the given counts actually show. Do not invent trends, causes, or details the data does not support, and do not extrapolate beyond this one day's snapshot.
- Never restate exact headcounts back to the user (no "3 people" or "12 people") — describe the makeup qualitatively instead (e.g. "many," "some," "a mix of people").
- Only credit the user with lifting the community's mood if their own most recent check-in today was upbeat (Calm or Good). If their own check-in was hard (Stressed or Low) or they have not checked in today, never claim they lifted anyone's mood or contributed positively — offer solidarity or a gentle invitation instead.
- Reply in plain English, second person ("you"), no bullet points, no emoji.`;

function bucketLines(buckets: MoodBucket[]): string[] {
  return buckets.filter((b) => b.count > 0).map((b) => `- ${b.label}: ${b.count}`);
}

const VALENCE_LINE: Record<UserMoodValence, string> = {
  positive: "The user's own most recent check-in today was upbeat (Calm or Good).",
  negative: "The user's own most recent check-in today was hard (Stressed or Low).",
  none: "The user has not checked in today.",
};

export function buildCommunitySummaryUserContent(data: CommunitySummaryData): string {
  const lines: string[] = [];
  lines.push("Today's community mood counts (already anonymized; small groups are hidden as 0):");
  const shown = bucketLines(data.buckets);
  lines.push(...(shown.length > 0 ? shown : ['- No visible counts today.']));
  lines.push('');
  lines.push(VALENCE_LINE[data.userValence]);
  lines.push('');
  lines.push(
    'Write one short, warm message (at most two short sentences) reflecting how the community is doing today and encouraging the user, following the safety rules above.'
  );
  return lines.join('\n');
}

export function buildCommunitySummaryPrompt(
  data: CommunitySummaryData
): CommunitySummaryPromptMessage[] {
  return [
    { role: 'system', content: COMMUNITY_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildCommunitySummaryUserContent(data) },
  ];
}

/**
 * Picks a hand-written line for accounts with AI off, which is the default. The lines follow
 * the same safety rules as the system prompt above.
 */
export function pickCommunityDemoLine(
  data: CommunitySummaryData,
  pick: <T>(options: T[]) => T = (options) =>
    options[Math.floor(Math.random() * options.length)]!
): string {
  const hard = data.buckets
    .filter((b) => b.label === 'Stressed' || b.label === 'Low')
    .reduce((sum, b) => sum + b.count, 0);
  const easy = data.buckets
    .filter((b) => b.label === 'Calm' || b.label === 'Good')
    .reduce((sum, b) => sum + b.count, 0);
  const skewsHard = hard > easy;

  if (skewsHard) {
    // An upbeat user is not told they fixed anyone's day, and a struggling one is not told to cheer up.
    return data.userValence === 'positive'
      ? pick([
          'A fair few people here are having a heavy one today, even though yours is going better. Holding both at once is allowed.',
          "It is a mixed day in your community, tilted toward the hard end. Glad yours is steadier — that does not take anything away from theirs.",
        ])
      : pick([
          "You are not the only one finding today hard — a lot of people here logged the same. That does not fix it, but you are in company.",
          'Plenty of people in your community are having a rough one too. Being in that together counts for a little.',
          "Today reads heavy for a lot of people here, you included. Nothing you have to do about that — stepping outside for a few minutes is there if you want it.",
        ]);
  }

  return data.userValence === 'positive'
    ? pick([
        'Your community is running mostly calm today, and you added to that. Nice to see.',
        "It is a steady day around here, yours included. Worth noticing when one of those comes along.",
      ])
    : pick([
        "Your community is having a mostly steady day, even if yours has not been. Both of those are true at once, and yours still counts.",
        "Most people here logged something calmer today. If yours has been harder, that is real too — and a short walk or a message to someone is there if it would help.",
      ]);
}
