/**
 * Per-account opt-in for real language-model calls; off for every new account. It is
 * opt-in because those calls send the participant's own words and derived numbers to a
 * third-party model API, so it follows the same shape as consent.
 */
import { create } from 'zustand';
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { setAiUserEnabled } from '../../services/aiGateway';
import { logEvent } from '../../services/logging';

const KEY = 'enableLlm';

export const LLM_ENABLED_DEFAULT = false;

export interface LlmSettingsState {
  enabled: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setEnabled: (value: boolean) => Promise<void>;
  /**
   * Drops the hydration so the next account re-reads its own row. Leaves the gateway
   * gated off in the meantime, which is the safe direction for an opt-in.
   */
  reset: () => void;
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS llm_settings (
         key TEXT NOT NULL,
         value INTEGER NOT NULL,
         uid TEXT NOT NULL DEFAULT 'local',
         PRIMARY KEY (key, uid)
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

function apply(value: boolean): void {
  setAiUserEnabled(value);
}

export const useLlmSettingsStore = create<LlmSettingsState>((set) => ({
  enabled: LLM_ENABLED_DEFAULT,
  loaded: false,

  load: async () => {
    try {
      await ensureTable();
      const rows = await queryAll<{ value: number }>(
        'SELECT value FROM llm_settings WHERE key = ? AND uid = ?',
        [KEY, getActiveUid()]
      );
      const enabled = rows.length > 0 ? rows[0]!.value !== 0 : LLM_ENABLED_DEFAULT;
      apply(enabled);
      set({ enabled, loaded: true });
    } catch {
      // Failing closed matters here: guessing "on" would start sending a participant's
      // words to a model API on the strength of a failed read.
      apply(LLM_ENABLED_DEFAULT);
      set({ enabled: LLM_ENABLED_DEFAULT, loaded: true });
    }
  },

  setEnabled: async (value) => {
    apply(value);
    set({ enabled: value });
    void logEvent('llm_enabled_changed', { enabled: value });
    // Group rooms record each member's setting, so Guide stops reading this person's messages at once.
    // Imported lazily: the community module imports this store.
    void import('../community/syncRoomAi').then((m) => m.syncJoinedRoomsAiFlag(value)).catch(() => {});
    try {
      await ensureTable();
      await exec(
        `INSERT INTO llm_settings (key, value, uid) VALUES (?, ?, ?)
         ON CONFLICT(key, uid) DO UPDATE SET value = excluded.value`,
        [KEY, value ? 1 : 0, getActiveUid()]
      );
    } catch {
    }
  },

  reset: () => {
    apply(LLM_ENABLED_DEFAULT);
    set({ enabled: LLM_ENABLED_DEFAULT, loaded: false });
  },
}));

export function isLlmEnabled(): boolean {
  return useLlmSettingsStore.getState().enabled;
}
