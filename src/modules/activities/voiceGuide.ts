/**
 * Spoken guide for an activity: an intro line, a cue at each phase change, and a closing
 * line. Each line plays a clip recorded ahead of time in one natural female voice
 * (scripts/gen-guide-voice.ts). Clips ship with the app, so the guide works offline.
 * The intro plays before the exercise clock starts, and every clip is loaded up front, so
 * each cue begins on the same frame as the animation for its phase.
 * A line without a clip stays silent; scripts/selfcheck-activities.ts fails until every line has one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { cycleLengthSec, type ActivityConfig, type PhaseState } from './config';
import { GUIDE_CLIPS } from './guideClips';
import { GUIDE_OUTRO, guideClipKey, guideLines } from './guideVoice';

/** Starts the exercise even if the intro's finish event never arrives; the longest intro is under 9s. */
const INTRO_MAX_MS = 15_000;

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
}

interface Clip {
  player: AudioPlayer;
  onFinish: (() => void) | null;
}

/** Players are kept and rewound rather than recreated, so play() starts at once instead of after a load. */
const loaded = new Map<string, Clip>();
let activeClip: Clip | null = null;

function rewind(clip: Clip): void {
  try {
    void clip.player.seekTo(0).catch(() => undefined);
  } catch {
  }
}

function loadClip(key: string): Clip | null {
  const existing = loaded.get(key);
  if (existing) return existing;
  const source = GUIDE_CLIPS[key];
  if (source == null) return null;
  let player: AudioPlayer;
  try {
    player = createAudioPlayer(source);
  } catch {
    return null;
  }
  const clip: Clip = { player, onFinish: null };
  player.addListener('playbackStatusUpdate', (status) => {
    if (!status.didJustFinish) return;
    // Rewound now, well before the next cycle needs it, since a seek right before play() can race it.
    rewind(clip);
    if (activeClip === clip) activeClip = null;
    const finish = clip.onFinish;
    clip.onFinish = null;
    finish?.();
  });
  loaded.set(key, clip);
  return clip;
}

function stopClip(): void {
  const clip = activeClip;
  activeClip = null;
  if (!clip) return;
  try {
    clip.player.pause();
  } catch {
  }
  rewind(clip);
  const finish = clip.onFinish;
  clip.onFinish = null;
  finish?.();
}

/** Loads every clip this activity can play, so none of its cues waits on a load. */
export function preloadGuide(activity: ActivityConfig): void {
  for (const line of guideLines([activity])) loadClip(guideClipKey(line));
}

export function releaseGuide(): void {
  stopClip();
  for (const clip of loaded.values()) {
    try {
      clip.player.remove();
    } catch {
    }
  }
  loaded.clear();
}

export function speakLine(text: string, callbacks: SpeakCallbacks = {}): void {
  const { onStart, onEnd } = callbacks;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };

  const clip = loadClip(guideClipKey(text));
  if (!clip) {
    finish();
    return;
  }

  // Two guide lines never talk over each other; the hook already drops a phase cue while one is playing.
  stopClip();
  // The same mode the music sets, repeated here for when the music is muted: without it iOS's silent switch mutes the guide.
  void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(
    () => undefined
  );

  clip.onFinish = finish;
  activeClip = clip;
  try {
    clip.player.play();
  } catch {
    stopClip();
    return;
  }
  onStart?.();
}

export function stopSpeaking(): void {
  stopClip();
}

function utteranceKey(activity: ActivityConfig, phase: PhaseState): string {
  const cycleLen = cycleLengthSec(activity);
  const cycle = cycleLen > 0 ? Math.floor(phase.totalElapsedSec / cycleLen) : 0;
  return `${cycle}:${phase.index}`;
}

export interface VoiceGuideOptions {
  activity: ActivityConfig | null;
  phaseState: PhaseState | null;
  running: boolean;
  completed: boolean;
  /** False until the user's voice setting is known, so the intro is neither skipped nor played by mistake. */
  ready: boolean;
  enabled: boolean;
}

export interface VoiceGuide {
  speaking: boolean;
  /** The exercise clock waits for this, so the first cue and the first phase of the animation start together. */
  introDone: boolean;
}

export function useVoiceGuide({
  activity,
  phaseState,
  running,
  completed,
  ready,
  enabled,
}: VoiceGuideOptions): VoiceGuide {
  const spokenRef = useRef<string | null>(null);
  const introSpokenRef = useRef(false);
  const outroSpokenRef = useRef(false);

  const [speaking, setSpeaking] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const activeRef = useRef(0);

  useEffect(() => {
    if (!activity) return undefined;
    preloadGuide(activity);
    return releaseGuide;
  }, [activity]);

  /**
   * Phase cues pass `skipIfBusy` so a cue that would start late, over a longer line still
   * playing, is dropped instead of cutting that line off. The intro and closing line never set it.
   */
  const speak = useCallback((text: string, skipIfBusy = false, onDone?: () => void) => {
    if (skipIfBusy && activeRef.current > 0) return;
    activeRef.current += 1;
    setSpeaking(true);
    speakLine(text, {
      onEnd: () => {
        activeRef.current = Math.max(0, activeRef.current - 1);
        if (activeRef.current === 0) setSpeaking(false);
        onDone?.();
      },
    });
  }, []);

  const silence = useCallback(() => {
    stopSpeaking();
    activeRef.current = 0;
    setSpeaking(false);
  }, []);

  useEffect(() => {
    if (enabled) return undefined;
    silence();
    return undefined;
  }, [enabled, silence]);

  // `completed` is left out on purpose: `running` also goes false when the activity
  // finishes, which is the exact moment the closing line is spoken.
  useEffect(() => {
    if (running || completed) return undefined;
    silence();
    return undefined;
  }, [running, completed, silence]);

  useEffect(() => silence, [silence]);

  // Muting or pausing during the intro stops the clip, which ends the intro and lets the exercise start.
  useEffect(() => {
    if (!ready || !activity || introSpokenRef.current) return;
    if (!enabled) {
      introSpokenRef.current = true;
      setIntroDone(true);
      return;
    }
    if (!running) return;
    introSpokenRef.current = true;
    speak(activity.voiceIntro, false, () => setIntroDone(true));
    setTimeout(() => setIntroDone(true), INTRO_MAX_MS);
  }, [ready, enabled, running, activity, speak]);

  useEffect(() => {
    if (!enabled || !running || !introDone || !activity || !phaseState || completed) return;
    const key = utteranceKey(activity, phaseState);
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    const phase = phaseState.phase;
    speak(phase.voice ?? phase.label, true);
  }, [enabled, running, introDone, activity, phaseState, completed, speak]);

  useEffect(() => {
    if (!completed || !activity || outroSpokenRef.current) return;
    outroSpokenRef.current = true;
    if (!enabled) return;
    speak(GUIDE_OUTRO);
  }, [completed, activity, enabled, speak]);

  return { speaking, introDone };
}
