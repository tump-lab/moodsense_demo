import { create } from 'zustand';
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { AMBIENT_TRACKS, DEFAULT_TRACK, type AmbientTrackId } from './music';

export interface ActivityAudioState {
  /** Stored in the older `muted` column, from when music was the only setting. */
  musicMuted: boolean;
  voiceMuted: boolean;
  track: AmbientTrackId;
  /** False until saved values are read back, so the player does not start on defaults and then cut off. */
  loaded: boolean;
  load: () => Promise<void>;
  setMusicMuted: (muted: boolean) => void;
  setVoiceMuted: (muted: boolean) => void;
  setTrack: (track: AmbientTrackId) => void;
  cycleTrack: () => void;
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await exec(
        `CREATE TABLE IF NOT EXISTS activity_audio_settings (
           uid TEXT PRIMARY KEY,
           muted INTEGER NOT NULL
         )`
      );
      // SQLite has no ADD COLUMN IF NOT EXISTS, so each add is tried alone and a throw means it exists.
      // `voice` is left over from when the guide had several voices; nothing reads it now.
      const addedColumns = [
        'voice_muted INTEGER NOT NULL DEFAULT 0',
        "voice TEXT NOT NULL DEFAULT 'calm'",
        `track TEXT NOT NULL DEFAULT '${DEFAULT_TRACK}'`,
      ];
      for (const column of addedColumns) {
        try {
          await exec(`ALTER TABLE activity_audio_settings ADD COLUMN ${column}`);
        } catch {
        }
      }
    })();
  }
  return tableReady;
}

interface SettingsRow {
  muted: number;
  voice_muted: number;
  track: AmbientTrackId;
}

function persist(state: { musicMuted: boolean; voiceMuted: boolean; track: AmbientTrackId }): void {
  void (async () => {
    try {
      await ensureTable();
      await exec(
        `INSERT INTO activity_audio_settings (uid, muted, voice_muted, track)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(uid) DO UPDATE SET
           muted = excluded.muted,
           voice_muted = excluded.voice_muted,
           track = excluded.track`,
        [getActiveUid(), state.musicMuted ? 1 : 0, state.voiceMuted ? 1 : 0, state.track]
      );
    } catch {
      // Not fatal: the in-memory choice still applies for this session.
    }
  })();
}

export const useActivityAudioStore = create<ActivityAudioState>((set, get) => ({
  musicMuted: false,
  voiceMuted: false,
  track: DEFAULT_TRACK,
  loaded: false,

  load: async () => {
    try {
      await ensureTable();
      const rows = await queryAll<SettingsRow>(
        'SELECT muted, voice_muted, track FROM activity_audio_settings WHERE uid = ?',
        [getActiveUid()]
      );
      const row = rows[0];
      const knownTrack = AMBIENT_TRACKS.some((t) => t.id === row?.track);
      set({
        musicMuted: (row?.muted ?? 0) === 1,
        voiceMuted: (row?.voice_muted ?? 0) === 1,
        // A track removed from the catalogue since it was saved would play silence, so fall back.
        track: knownTrack ? (row!.track as AmbientTrackId) : DEFAULT_TRACK,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  setMusicMuted: (musicMuted) => {
    set({ musicMuted });
    persist({ ...get(), musicMuted });
  },

  setVoiceMuted: (voiceMuted) => {
    set({ voiceMuted });
    persist({ ...get(), voiceMuted });
  },

  setTrack: (track) => {
    set({ track });
    persist({ ...get(), track });
  },

  cycleTrack: () => {
    const ids = AMBIENT_TRACKS.map((t) => t.id);
    const next = ids[(ids.indexOf(get().track) + 1) % ids.length];
    get().setTrack(next);
  },
}));
