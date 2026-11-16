/**
 * Static config and pure logic for the guided activities on the Home screen.
 * No React or React Native imports here (only a type-only `Mood`), so scripts/selfcheck-activities.ts can run this from plain Node.
 */
import type { Mood } from '../../services/db';

export type ActivityKind = 'breathing' | 'stretch' | 'grounding';

export interface ActivityPhase {
  label: string;
  seconds: number;
  scaleTo?: number;
  icon?: string;
  voice?: string;
}

export type ActivityGoal =
  | 'calm'
  | 'grounded'
  | 'present'
  | 'focused'
  | 'confident'
  | 'energized'
  | 'lighter'
  | 'less tense';

export interface ActivityConfig {
  id: string;
  title: string;
  kind: ActivityKind;
  goal: ActivityGoal;
  durationSec: number;
  description: string;
  emoji: string;
  hint: string;
  /**
   * One cycle of phases. Breathing activities loop this cycle for the full durationSec; stretch/grounding run the list once, so their phase seconds should sum to durationSec.
   */
  phases: ActivityPhase[];
  voiceIntro: string;
}

export const ACTIVITIES: ActivityConfig[] = [
  {
    id: 'box-breathing',
    title: 'Box Breathing',
    kind: 'breathing',
    goal: 'focused',
    durationSec: 128, // 8 full 16s (4-4-4-4) cycles, about 2 min

    description: 'Inhale, hold, exhale, hold — 4 seconds each, on repeat.',
    emoji: '\u{1FAE7}',
    hint: 'Even, steady rhythm',
    voiceIntro: 'Okay, sit comfortably and let your shoulders drop. We\'re going to breathe in a square. In, hold, out, hold. Just follow along with me.',
    phases: [
      { label: 'Breathe in', seconds: 4, scaleTo: 1 },
      { label: 'Hold', seconds: 4, scaleTo: 1 },
      { label: 'Breathe out', seconds: 4, scaleTo: 0.55 },
      { label: 'Hold', seconds: 4, scaleTo: 0.55 },
    ],
  },
  {
    id: 'calming-breath',
    title: 'Calming Breathing',
    kind: 'breathing',
    goal: 'calm',
    durationSec: 60,
    description: 'A shorter reset — breathe in for 4, out for 6.',
    emoji: '\u{1F319}',
    hint: 'Longer out-breath',
    voiceIntro: 'Let your jaw soften a little. Slow breath in, and then a longer breath out. That long out-breath is the part that calms you down.',
    phases: [
      { label: 'Breathe in', seconds: 4, scaleTo: 1 },
      { label: 'Breathe out', seconds: 6, scaleTo: 0.55, voice: 'And slowly out' },
    ],
  },
  {
    id: 'quick-stretch',
    title: 'Quick Stretch',
    kind: 'stretch',
    goal: 'energized',
    durationSec: 60,
    description: 'Four simple stretches you can do right where you sit.',
    emoji: '\u{1F938}',
    hint: 'Stay in your seat',
    voiceIntro: 'You can stay right where you are. Four easy stretches, about fifteen seconds each. Go gently, nothing should hurt.',
    phases: [
      {
        label: 'Neck roll',
        seconds: 15,
        icon: 'body-outline',
        voice: 'Let your chin drop toward your chest, and roll your head slowly from one shoulder to the other.',
      },
      {
        label: 'Shoulder rolls',
        seconds: 15,
        icon: 'accessibility-outline',
        voice: 'Now roll your shoulders backward, big and slow. Let them fall away from your ears.',
      },
      {
        label: 'Forward fold',
        seconds: 15,
        icon: 'walk-outline',
        voice: 'Fold forward over your legs and let your arms and head hang heavy. Breathe into your back.',
      },
      {
        label: 'Side stretch',
        seconds: 15,
        icon: 'leaf-outline',
        voice: 'Sit tall, reach one arm overhead and lean to the side. Halfway through, switch sides.',
      },
    ],
  },
  {
    id: 'body-scan',
    title: 'Body Scan',
    kind: 'grounding',
    goal: 'grounded',
    durationSec: 120,
    description: 'A slow head-to-toe scan to settle your attention.',
    emoji: '\u{1F9D8}',
    hint: 'Head to toe',
    voiceIntro: 'Get comfortable, and close your eyes if you like. We\'re just going to notice the body, one part at a time. There\'s nothing you need to fix.',
    phases: [
      {
        label: 'Notice your feet',
        seconds: 24,
        icon: 'footsteps-outline',
        voice: 'Bring your attention down to your feet. Feel the floor underneath them.',
      },
      {
        label: 'Notice your legs',
        seconds: 24,
        icon: 'walk-outline',
        voice: 'Move up into your legs. Notice their weight resting where you sit.',
      },
      {
        label: 'Notice your breath',
        seconds: 24,
        icon: 'leaf-outline',
        voice: 'Now the breath. Follow it in, and follow it out. No need to change it.',
      },
      {
        label: 'Notice your shoulders',
        seconds: 24,
        icon: 'accessibility-outline',
        voice: 'Come up to your shoulders and your jaw. If they\'re holding something, let them soften.',
      },
      {
        label: 'Notice your whole body',
        seconds: 24,
        icon: 'body-outline',
        voice: 'And now the whole body at once. Just breathing, and here.',
      },
    ],
  },
  {
    id: 'senses-grounding',
    title: '5-4-3-2-1 Senses',
    kind: 'grounding',
    goal: 'present',
    durationSec: 120,
    description: 'Name what you can see, hear and feel to come back to the room.',
    emoji: '\u{1F441}',
    hint: 'Look, listen, touch',
    voiceIntro: 'Open your eyes and have a look around. We\'ll use your senses, one at a time, to bring you back into this room.',
    phases: [
      {
        label: 'Five things you see',
        seconds: 30,
        icon: 'eye-outline',
        voice: 'Find five things you can see. Name each one to yourself, slowly.',
      },
      {
        label: 'Four things you feel',
        seconds: 25,
        icon: 'hand-left-outline',
        voice: 'Now four things you can feel. The chair, your feet, the air, your clothes.',
      },
      {
        label: 'Three things you hear',
        seconds: 25,
        icon: 'ear-outline',
        voice: 'Three things you can hear. Listen past the closest sound to the ones behind it.',
      },
      {
        label: 'Two things you smell',
        seconds: 20,
        icon: 'flower-outline',
        voice: 'Two things you can smell, even faintly.',
      },
      {
        label: 'One slow breath',
        seconds: 20,
        icon: 'leaf-outline',
        voice: 'And one slow breath. You\'re here, in this room, right now.',
      },
    ],
  },
  {
    id: 'power-pose',
    title: 'Stand Tall',
    kind: 'stretch',
    goal: 'confident',
    durationSec: 75,
    description: 'Open posture and a few steady lines to say before what is next.',
    emoji: '\u{1F31F}',
    hint: 'Posture and self-talk',
    voiceIntro: 'Stand up if you can, with your feet under your hips. We\'re going to take up a bit more space than usual.',
    phases: [
      {
        label: 'Ground your feet',
        seconds: 15,
        icon: 'footsteps-outline',
        voice: 'Press both feet into the floor. Feel how steady the ground is under you.',
      },
      {
        label: 'Open your chest',
        seconds: 15,
        icon: 'accessibility-outline',
        voice: 'Roll your shoulders back and lift your chest. Let your arms rest wide and open.',
      },
      {
        label: 'Lift your gaze',
        seconds: 15,
        icon: 'eye-outline',
        voice: 'Lift your chin and look straight ahead. Breathe into the top of your chest.',
      },
      {
        label: 'Say it to yourself',
        seconds: 15,
        icon: 'chatbubble-ellipses-outline',
        voice: 'Say this to yourself. I\'ve handled hard things before. I can handle this one.',
      },
      {
        label: 'Carry it with you',
        seconds: 15,
        icon: 'walk-outline',
        voice: 'Hold this shape for one more breath, and take it with you into whatever is next.',
      },
    ],
  },
  {
    id: 'gratitude-pause',
    title: 'Three Good Things',
    kind: 'grounding',
    goal: 'lighter',
    durationSec: 120,
    description: 'Bring to mind three things that went right, however small.',
    emoji: '\u{1F33F}',
    hint: 'However small',
    voiceIntro: 'Settle back. We\'re going to look for three good things from today. Small ones count, honestly they\'re the best ones.',
    phases: [
      {
        label: 'Something small today',
        seconds: 30,
        icon: 'sunny-outline',
        voice: 'Think of one small thing that went well today. A coffee, a message, a quiet minute.',
      },
      {
        label: 'Someone you are glad for',
        seconds: 30,
        icon: 'people-outline',
        voice: 'Now bring to mind one person you\'re glad is in your life, and why.',
      },
      {
        label: 'Something about you',
        seconds: 30,
        icon: 'heart-outline',
        voice: 'And one thing about yourself you wouldn\'t want to trade away.',
      },
      {
        label: 'Let it settle',
        seconds: 30,
        icon: 'leaf-outline',
        voice: 'Hold all three together for a moment, and let the day feel a little lighter.',
      },
    ],
  },
];

export function getActivity(id: string): ActivityConfig | undefined {
  return ACTIVITIES.find((a) => a.id === id);
}

const MOOD_BIAS_RANK: Record<ActivityKind, number> = {
  breathing: 0,
  grounding: 1,
  stretch: 2,
};

export function orderActivitiesForMood(
  activities: ActivityConfig[],
  latestMood: Mood | null
): ActivityConfig[] {
  if (latestMood !== 'stressed' && latestMood !== 'low' && latestMood !== 'tired') return activities;
  return [...activities].sort((a, b) => MOOD_BIAS_RANK[a.kind] - MOOD_BIAS_RANK[b.kind]);
}

// Hand-written picks per mood. The same exercise can appear under different goals in different moods (a stretch is "energized" on a good day and "less tense" on a stressed one), which is why each pick pairs a goal with an id.

export const MAX_RECOMMENDED = 2;

export interface ActivityRecommendation {
  activity: ActivityConfig;
  goal: ActivityGoal;
}

interface MoodPick {
  goal: ActivityGoal;
  id: string;
}

const MOOD_PICKS: Record<Mood, MoodPick[]> = {
  stressed: [
    { goal: 'calm', id: 'calming-breath' },
    { goal: 'grounded', id: 'body-scan' },
    { goal: 'present', id: 'senses-grounding' },
    { goal: 'less tense', id: 'quick-stretch' },
  ],
  low: [
    { goal: 'lighter', id: 'gratitude-pause' },
    { goal: 'energized', id: 'quick-stretch' },
    { goal: 'confident', id: 'power-pose' },
    { goal: 'calm', id: 'calming-breath' },
  ],
  calm: [
    { goal: 'focused', id: 'box-breathing' },
    { goal: 'grounded', id: 'body-scan' },
    { goal: 'present', id: 'senses-grounding' },
    { goal: 'confident', id: 'power-pose' },
  ],
  tired: [
    { goal: 'calm', id: 'calming-breath' },
    { goal: 'energized', id: 'quick-stretch' },
    { goal: 'grounded', id: 'body-scan' },
    { goal: 'lighter', id: 'gratitude-pause' },
  ],
  good: [
    { goal: 'energized', id: 'quick-stretch' },
    { goal: 'focused', id: 'box-breathing' },
    { goal: 'confident', id: 'power-pose' },
    { goal: 'lighter', id: 'gratitude-pause' },
  ],
};

const DEFAULT_PICKS: MoodPick[] = [
  { goal: 'calm', id: 'calming-breath' },
  { goal: 'grounded', id: 'body-scan' },
  { goal: 'focused', id: 'box-breathing' },
  { goal: 'energized', id: 'quick-stretch' },
];

export function goalHeadline(goal: ActivityGoal): string {
  return `To Feel ${goal.replace(/\b\w/g, (c) => c.toUpperCase())}`;
}

export function recommendActivitiesForMood(
  activities: ActivityConfig[],
  latestMood: Mood | null,
  max: number = MAX_RECOMMENDED
): ActivityRecommendation[] {
  const picked: ActivityRecommendation[] = [];
  const picks = latestMood ? (MOOD_PICKS[latestMood] ?? DEFAULT_PICKS) : DEFAULT_PICKS;
  for (const pick of picks) {
    if (picked.length >= max) break;
    const activity = activities.find((a) => a.id === pick.id);
    if (activity && !picked.some((p) => p.activity === activity)) {
      picked.push({ activity, goal: pick.goal });
    }
  }

  // If the picks table is short, top up from the mood-biased order, preferring an activity whose goal and kind aren't on the list yet.
  const rest = orderActivitiesForMood(activities, latestMood).filter(
    (a) => !picked.some((p) => p.activity === a)
  );
  while (picked.length < max && rest.length > 0) {
    const goals = new Set(picked.map((p) => p.goal));
    const kinds = new Set(picked.map((p) => p.activity.kind));
    const freshBoth = rest.findIndex((a) => !goals.has(a.goal) && !kinds.has(a.kind));
    const freshGoal = rest.findIndex((a) => !goals.has(a.goal));
    const index = freshBoth >= 0 ? freshBoth : freshGoal >= 0 ? freshGoal : 0;
    const [activity] = rest.splice(index, 1);
    picked.push({ activity, goal: activity.goal });
  }
  return picked.slice(0, Math.max(0, max));
}

export function cycleLengthSec(activity: ActivityConfig): number {
  return activity.phases.reduce((sum, p) => sum + p.seconds, 0);
}

export interface PhaseState {
  index: number;
  phase: ActivityPhase;
  phaseElapsedSec: number;
  phaseRemainingSec: number;
  totalElapsedSec: number;
  totalRemainingSec: number;
  done: boolean;
}

export function computePhaseState(activity: ActivityConfig, elapsedSec: number): PhaseState {
  const total = activity.durationSec;
  const totalElapsedSec = Math.min(Math.max(elapsedSec, 0), total);
  const done = elapsedSec >= total;
  const cycleLen = cycleLengthSec(activity);
  const posInCycle = cycleLen > 0 ? totalElapsedSec % cycleLen : 0;

  let acc = 0;
  let index = 0;
  for (let i = 0; i < activity.phases.length; i += 1) {
    const p = activity.phases[i];
    const isLast = i === activity.phases.length - 1;
    if (posInCycle < acc + p.seconds || isLast) {
      index = i;
      break;
    }
    acc += p.seconds;
  }

  const phase = activity.phases[index];
  const phaseElapsedSec = Math.min(Math.max(posInCycle - acc, 0), phase.seconds);

  return {
    index,
    phase,
    phaseElapsedSec,
    phaseRemainingSec: Math.max(0, phase.seconds - phaseElapsedSec),
    totalElapsedSec,
    totalRemainingSec: Math.max(0, total - totalElapsedSec),
    done,
  };
}

export function formatClock(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function minutesLabel(durationSec: number): string {
  const mins = Math.max(1, Math.round(durationSec / 60));
  return mins === 1 ? '1 minute' : `${mins} minutes`;
}
