/**
 * Mood Check (PHQ-4) cadence preference: weekly by default, daily if the user opts in.
 * The code keeps the name `phq4` so the research record of which survey was used stays the same.
 */
import { create } from 'zustand';
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';

export type Phq4Cadence = 'weekly' | 'daily';

export interface Phq4CadenceState {
  cadence: Phq4Cadence;
  loaded: boolean;
  load: () => Promise<void>;
  setCadence: (cadence: Phq4Cadence) => Promise<void>;
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS phq4_cadence (
         uid TEXT PRIMARY KEY,
         cadence TEXT NOT NULL
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

export const usePhq4CadenceStore = create<Phq4CadenceState>((set) => ({
  cadence: 'weekly',
  loaded: false,

  load: async () => {
    await ensureTable();
    const rows = await queryAll<{ cadence: Phq4Cadence }>(
      'SELECT cadence FROM phq4_cadence WHERE uid = ?',
      [getActiveUid()]
    );
    set({ cadence: rows[0]?.cadence ?? 'weekly', loaded: true });
  },

  setCadence: async (cadence) => {
    set({ cadence });
    await ensureTable();
    await exec(
      `INSERT INTO phq4_cadence (uid, cadence) VALUES (?, ?)
       ON CONFLICT(uid) DO UPDATE SET cadence = excluded.cadence`,
      [getActiveUid(), cadence]
    );
  },
}));
