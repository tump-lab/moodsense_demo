/**
 * One sound loop at a time, app-wide, in a module-level store so playback outlives the screen that started it.
 * Every player stays in `livePlayers` until it is silenced, because dropping a reference before its fade-out finished once left a loop playing that no button could stop.
 */
import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { getSoundscape, type Soundscape, type SoundscapeId } from './config';

const BASE_VOLUME = 0.6;
const FADE_IN_MS = 700;
const FADE_STEPS = 10;

/** Each player maps to the cancel for its own running fade, so a new fade only cancels its own predecessor. */
const livePlayers = new Map<AudioPlayer, () => void>();

function fade(player: AudioPlayer, target: number, durationMs: number, onDone?: () => void): void {
  livePlayers.get(player)?.();
  const start = (() => {
    try {
      return player.volume;
    } catch {
      return 0;
    }
  })();
  let step = 0;
  const id = setInterval(() => {
    step += 1;
    const t = Math.min(1, step / FADE_STEPS);
    try {
      player.volume = start + (target - start) * t;
    } catch {
      clearInterval(id);
      onDone?.();
      return;
    }
    if (t >= 1) {
      clearInterval(id);
      onDone?.();
    }
  }, Math.max(16, durationMs / FADE_STEPS));
  livePlayers.set(player, () => clearInterval(id));
}

function destroy(player: AudioPlayer): void {
  livePlayers.get(player)?.();
  livePlayers.delete(player);
  try {
    player.pause();
  } catch {
  }
  try {
    player.remove();
  } catch {
  }
}

/** No fade-out on purpose: a fade timer can be throttled or never fire, and stop must be the one thing that cannot fail. */
function stopAll(): void {
  for (const player of [...livePlayers.keys()]) destroy(player);
}

function startPlayer(sound: Soundscape): boolean {
  void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(
    () => undefined
  );
  try {
    const next = createAudioPlayer(sound.source);
    next.loop = true;
    next.volume = 0;
    next.play();
    livePlayers.set(next, () => undefined);
    fade(next, Math.min(1, BASE_VOLUME * sound.gain), FADE_IN_MS);
    return true;
  } catch (err) {
    console.warn('[sounds] failed to start', sound.id, err);
    return false;
  }
}

export interface SoundPlayerState {
  playingId: SoundscapeId | null;
  play: (id: SoundscapeId) => void;
  stop: () => void;
  toggle: (id: SoundscapeId) => void;
}

export const useSoundPlayerStore = create<SoundPlayerState>((set, get) => ({
  playingId: null,

  play: (id) => {
    const sound = getSoundscape(id);
    if (!sound) return;
    // Silence what's playing before anything new starts; starting first and letting the old one fade is how two loops overlapped.
    stopAll();
    set({ playingId: startPlayer(sound) ? id : null });
  },

  stop: () => {
    stopAll();
    set({ playingId: null });
  },

  toggle: (id) => {
    if (get().playingId === id) get().stop();
    else get().play(id);
  },
}));

// Registered once at module load so the listener outlives any screen. The app has no background-audio entitlement, so it pauses on background and resumes on return.
let backgroundedId: SoundscapeId | null = null;
AppState.addEventListener('change', (state: AppStateStatus) => {
  const { playingId, play, stop } = useSoundPlayerStore.getState();
  if (state === 'active') {
    if (backgroundedId && !playingId) play(backgroundedId);
    backgroundedId = null;
  } else if (playingId) {
    backgroundedId = playingId;
    stop();
  }
});
