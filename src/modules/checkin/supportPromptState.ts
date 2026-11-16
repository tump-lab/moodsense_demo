/**
 * Remembers when the support prompt was last shown, per account, so the cooldown in
 * supportPrompt.ts survives a relaunch.
 *
 * Local only, with no Firestore mirror: a participant who signs in on a second device
 * can meet the prompt once more there. That is the mistake worth making over a missed
 * offer of help, and it keeps this off the upload path.
 */
import { create } from 'zustand';
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';

export interface SupportPromptState {
  /** Epoch ms, or null if the prompt has never been shown to this account. */
  lastShownAt: number | null;
  loaded: boolean;
  load: () => Promise<void>;
  markShown: (at?: number) => Promise<void>;
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS support_prompt_state (
         uid TEXT PRIMARY KEY,
         last_shown_at INTEGER NOT NULL
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

export const useSupportPromptStore = create<SupportPromptState>((set) => ({
  lastShownAt: null,
  loaded: false,

  load: async () => {
    try {
      await ensureTable();
      const rows = await queryAll<{ last_shown_at: number }>(
        'SELECT last_shown_at FROM support_prompt_state WHERE uid = ?',
        [getActiveUid()]
      );
      set({ lastShownAt: rows[0]?.last_shown_at ?? null, loaded: true });
    } catch {
      // If the cooldown cannot be read there is no way to tell a first offer from a
      // tenth, so stand down for now: a prompt that reappears on every launch would
      // land on someone already having a hard week.
      set({ lastShownAt: Date.now(), loaded: true });
    }
  },

  markShown: async (at: number = Date.now()) => {
    set({ lastShownAt: at });
    try {
      await ensureTable();
      await exec(
        `INSERT INTO support_prompt_state (uid, last_shown_at) VALUES (?, ?)
         ON CONFLICT(uid) DO UPDATE SET last_shown_at = excluded.last_shown_at`,
        [getActiveUid(), at]
      );
    } catch {
      // The in-memory value still holds the prompt back for the rest of this session.
    }
  },
}));
