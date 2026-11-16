/**
 * Pure logic for the spoken guide's recorded clips: which voice they use, how each is named, and which lines need one.
 * No React or asset imports, so scripts/selfcheck-activities.ts and scripts/gen-guide-voice.ts can run it from plain Node; ./voiceGuide.ts is the side-effecting half.
 */
import type { ActivityConfig } from './config';

/** Spoken once when an activity finishes. */
export const GUIDE_OUTRO = "And that is it. Take a second to notice how you feel before you move on.";

/**
 * The one Kokoro voice every guide clip is recorded with by scripts/gen-guide-voice.ts: a warm female voice.
 * It is part of the clip key, so changing it orphans every clip until they are regenerated.
 */
export const GUIDE_CLIP_VOICE = 'af_heart';

/** Names the recorded clip for one line: assets/audio/guide/<key>.m4a. */
export function guideClipKey(text: string): string {
  const s = `${GUIDE_CLIP_VOICE}|${text.trim()}`;
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return `guide-${hash.toString(16).padStart(8, '0')}`;
}

/** Every line the guide can say across these activities, deduplicated, outro last. */
export function guideLines(activities: readonly ActivityConfig[]): string[] {
  const lines = new Set<string>();
  for (const activity of activities) {
    lines.add(activity.voiceIntro.trim());
    for (const phase of activity.phases) lines.add((phase.voice ?? phase.label).trim());
  }
  lines.add(GUIDE_OUTRO);
  return [...lines];
}
