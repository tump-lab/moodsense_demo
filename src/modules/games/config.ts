/**
 * Calming games for the Companion tab's "Take a moment" sheet: no score, no timer, no way to fail, because a game you can lose can raise your heart rate.
 * Kept free of React imports so it stays plain data, like activities/config.ts.
 */

export type GameId = 'bubble-pop' | 'ripple-pond' | 'constellation';

export interface GameConfig {
  id: GameId;
  title: string;
  /** One line for the list row. */
  hint: string;
  emoji: string;
  /** Shown at the top of the game: what to do, in one sentence. */
  instruction: string;
}

export const GAMES: GameConfig[] = [
  {
    id: 'bubble-pop',
    title: 'Bubble pop',
    hint: 'Pop them as they drift up',
    emoji: '\u{1FAE7}',
    instruction: 'Tap the bubbles as they float by. There is no score — pop as few or as many as you like.',
  },
  {
    id: 'ripple-pond',
    title: 'Ripple pond',
    hint: 'Tap anywhere, watch it spread',
    emoji: '\u{1F4A7}',
    instruction: 'Touch the water anywhere. Watch each ripple travel out until it fades.',
  },
  {
    id: 'constellation',
    title: 'Constellation',
    hint: 'Join the stars, one by one',
    emoji: '\u{2728}',
    instruction: 'Tap the stars in any order to join them. When the last one lights up, a new sky appears.',
  },
];

export function getGame(id: string): GameConfig | undefined {
  return GAMES.find((g) => g.id === id);
}
