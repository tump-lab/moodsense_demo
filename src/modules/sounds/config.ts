/**
 * Ambient loops for the Companion tab's "Take a moment" sheet, all made by scripts/gen-soundscapes.py so they carry no third-party license and loop with no seam.
 * The `require`d .wav files only resolve through Metro, so scripts/selfcheck-discover.ts checks the asset paths by reading this file as text.
 */

export type SoundscapeId =
  | 'rain'
  | 'forest'
  | 'summer-night'
  | 'ocean'
  | 'fireplace'
  | 'stream';

export interface Soundscape {
  id: SoundscapeId;
  title: string;
  /** One short line for the list row — what it sounds like, not what it does. */
  hint: string;
  emoji: string;
  /**
   * Playback gain, applied on top of the player's own volume. The loops are
   * peak-normalized at generation time, which leaves the transient-heavy
   * ones (fireplace's crackle) noticeably quieter in perceived loudness than
   * the steady ones; this evens them out so switching tracks doesn't mean
   * reaching for the volume keys.
   */
  gain: number;
  /** `require`d asset — `any` because Metro's asset requires aren't typed. */
  source: number;
}

export const SOUNDSCAPES: Soundscape[] = [
  {
    id: 'rain',
    title: 'Rain',
    hint: 'Steady rainfall, soft drops',
    emoji: '\u{1F327}',
    gain: 1.0,
    source: require('../../../assets/audio/soundscapes/rain.wav'),
  },
  {
    id: 'forest',
    title: 'Forest',
    hint: 'Wind in leaves, distant birds',
    emoji: '\u{1F332}',
    gain: 1.05,
    source: require('../../../assets/audio/soundscapes/forest.wav'),
  },
  {
    id: 'summer-night',
    title: 'Summer night',
    hint: 'Crickets and warm still air',
    emoji: '\u{1F319}',
    gain: 1.1,
    source: require('../../../assets/audio/soundscapes/summer-night.wav'),
  },
  {
    id: 'ocean',
    title: 'Ocean',
    hint: 'Long waves, slow swell',
    emoji: '\u{1F30A}',
    gain: 1.05,
    source: require('../../../assets/audio/soundscapes/ocean.wav'),
  },
  {
    id: 'fireplace',
    title: 'Fireplace',
    hint: 'Low roar and crackle',
    emoji: '\u{1F525}',
    gain: 1.6,
    source: require('../../../assets/audio/soundscapes/fireplace.wav'),
  },
  {
    id: 'stream',
    title: 'Stream',
    hint: 'Running water over stones',
    emoji: '\u{1F4A7}',
    gain: 1.0,
    source: require('../../../assets/audio/soundscapes/stream.wav'),
  },
];

export function getSoundscape(id: string): Soundscape | undefined {
  return SOUNDSCAPES.find((s) => s.id === id);
}
