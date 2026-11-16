/**
 * Loops the background music under every activity, using expo-audio's imperative player.
 * It sets `mixWithOthers` and never touches `allowsRecording`, so it cannot fight the spoken guide or clobber a voice call's mic session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useActivityAudioStore } from './soundSettings';
import { getAmbientTrack } from './music';

/** Loud enough to hear on a phone speaker in a quiet room, quiet enough not to compete with the spoken guide; 0.32 was barely audible. */
const TARGET_VOLUME = 0.5;
const DUCK_RATIO = 0.4;
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 700;
const DUCK_FADE_MS = 320;
const FADE_STEPS = 12;

function fadeVolume(
  player: AudioPlayer,
  target: number,
  durationMs: number,
  onDone?: () => void
): () => void {
  const start = player.volume;
  const stepMs = Math.max(16, durationMs / FADE_STEPS);
  let step = 0;
  const id = setInterval(() => {
    step += 1;
    const t = Math.min(1, step / FADE_STEPS);
    try {
      player.volume = start + (target - start) * t;
    } catch {
      // The player went away mid-ramp; still call onDone, since that is what releases the player.
      clearInterval(id);
      onDone?.();
      return;
    }
    if (t >= 1) {
      clearInterval(id);
      onDone?.();
    }
  }, stepMs);
  return () => clearInterval(id);
}

export interface AmbientAudio {
  muted: boolean;
  toggleMute: () => void;
  trackTitle: string;
  cycleTrack: () => void;
}

export function useAmbientAudio(enabled: boolean, duck: boolean = false): AmbientAudio {
  const muted = useActivityAudioStore((s) => s.musicMuted);
  const setMusicMuted = useActivityAudioStore((s) => s.setMusicMuted);
  const trackId = useActivityAudioStore((s) => s.track);
  const cycleTrack = useActivityAudioStore((s) => s.cycleTrack);
  const prefsLoaded = useActivityAudioStore((s) => s.loaded);
  const load = useActivityAudioStore((s) => s.load);
  const track = getAmbientTrack(trackId);
  const targetVolume = Math.min(1, TARGET_VOLUME * track.gain);
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');
  const playerRef = useRef<AudioPlayer | null>(null);
  const duckedRef = useRef(false);
  const targetVolumeRef = useRef(targetVolume);
  targetVolumeRef.current = targetVolume;
  const duckRef = useRef(duck);
  duckRef.current = duck;

  useEffect(() => {
    if (!prefsLoaded) void load();
  }, [prefsLoaded, load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      setIsForeground(state === 'active');
    });
    return () => sub.remove();
  }, []);

  // Not gated on the saved preference having loaded: the worst case is a moment of music for someone who muted it, while waiting risks silence forever.
  const shouldPlay = enabled && !muted && isForeground;

  useEffect(() => {
    if (!shouldPlay) return undefined;

    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(
      () => undefined
    );

    let player: AudioPlayer;
    try {
      player = createAudioPlayer(track.source);
      player.loop = true;
      player.volume = 0;
      player.play();
    } catch (err) {
      console.warn('[activities] background music failed to start:', err);
      return undefined;
    }
    playerRef.current = player;
    duckedRef.current = duckRef.current;
    const fadeInTarget = duckedRef.current
      ? targetVolumeRef.current * DUCK_RATIO
      : targetVolumeRef.current;
    const stopFadeIn = fadeVolume(player, fadeInTarget, FADE_IN_MS);

    return () => {
      stopFadeIn();
      playerRef.current = null;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          player.pause();
          player.remove();
        } catch {
        }
      };
      // The timer backstop matters: a throttled fade timer would otherwise leave the music playing with nothing left to stop it.
      fadeVolume(player, 0, FADE_OUT_MS, release);
      setTimeout(release, FADE_OUT_MS + 500);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, track.source]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !shouldPlay) return undefined;
    if (duckedRef.current === duck) return undefined;
    duckedRef.current = duck;
    const full = targetVolumeRef.current;
    return fadeVolume(player, duck ? full * DUCK_RATIO : full, DUCK_FADE_MS);
  }, [duck, shouldPlay, track.source]);

  const toggleMute = useCallback(() => {
    setMusicMuted(!muted);
  }, [muted, setMusicMuted]);

  return { muted, toggleMute, trackTitle: track.title, cycleTrack };
}
