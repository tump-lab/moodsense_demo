/**
 * The music beds the activity player can loop under a guided exercise; the `require`d .wav assets only resolve through Metro, so this file cannot be imported from plain Node.
 * Every bed is synthesized by scripts/gen-ambient-beds.py, so no third-party license is attached.
 */

export type AmbientTrackId = 'warm-pad' | 'moonlight' | 'first-light' | 'deep-rest';

export interface AmbientTrack {
  id: AmbientTrackId;
  title: string;
  hint: string;
  /** Evens out the beds' loudness, since peak-normalizing at generation leaves the darker ones quieter and switching beds mid-exercise would otherwise jump. */
  gain: number;
  source: number;
}

export const AMBIENT_TRACKS: AmbientTrack[] = [
  {
    id: 'warm-pad',
    title: 'Warm pad',
    hint: 'Low strings and a soft bell',
    gain: 1.0,
    source: require('../../../assets/audio/ambient/warm-pad.wav'),
  },
  {
    id: 'moonlight',
    title: 'Moonlight',
    hint: 'Darker and slower, for evenings',
    gain: 1.1,
    source: require('../../../assets/audio/ambient/moonlight.wav'),
  },
  {
    id: 'first-light',
    title: 'First light',
    hint: 'Brighter and open, not melancholy',
    gain: 0.95,
    source: require('../../../assets/audio/ambient/first-light.wav'),
  },
  {
    id: 'deep-rest',
    title: 'Deep rest',
    hint: 'Almost a drone — barely there',
    gain: 1.15,
    source: require('../../../assets/audio/ambient/deep-rest.wav'),
  },
];

export const DEFAULT_TRACK: AmbientTrackId = 'warm-pad';

export function getAmbientTrack(id: string): AmbientTrack {
  return AMBIENT_TRACKS.find((t) => t.id === id) ?? AMBIENT_TRACKS[0];
}
