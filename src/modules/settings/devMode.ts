/**
 * Developer mode: an off-by-default switch that reveals engineering detail (raw sensor tiles, upload-queue depth) that participants must never see.
 * It is per device rather than per uid, and not tied to __DEV__, because the state worth inspecting only shows up on release-ish builds on a real device.
 */
import { create } from 'zustand';
import { exec, queryAll } from '../../services/db';
import { logEvent } from '../../services/logging';
import { useCheckinStore } from '../checkin/store';
import { clearDemoData, seedScreenshotData } from '../sensing/mockData';

const KEY = 'devMode';
const SCREENSHOT_KEY = 'screenshotMode';

export interface DevModeState {
  enabled: boolean;
  /**
   * Screenshot mode (dev builds, Developer mode on): fills the account with a month of realistic
   * demo data and drops the "sample" labels and developer notices, so screens can be captured for
   * papers and demos. Off by default; turning it (or Developer mode) off removes the demo rows.
   */
  screenshot: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setEnabled: (value: boolean) => Promise<void>;
  setScreenshot: (value: boolean) => Promise<void>;
}

async function writeSetting(key: string, value: boolean): Promise<void> {
  try {
    await ensureTable();
    await exec(
      `INSERT INTO dev_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value ? 1 : 0]
    );
  } catch {
  }
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS dev_settings (
         key TEXT PRIMARY KEY,
         value INTEGER NOT NULL
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

export const useDevModeStore = create<DevModeState>((set) => ({
  enabled: false,
  screenshot: false,
  loaded: false,

  load: async () => {
    try {
      await ensureTable();
      const rows = await queryAll<{ key: string; value: number }>(
        'SELECT key, value FROM dev_settings WHERE key IN (?, ?)',
        [KEY, SCREENSHOT_KEY]
      );
      const on = (k: string) => (rows.find((r) => r.key === k)?.value ?? 0) !== 0;
      const enabled = on(KEY);
      set({ enabled, screenshot: __DEV__ && enabled && on(SCREENSHOT_KEY), loaded: true });
    } catch {
      // DB unavailable: stay off, since guessing "on" would show a participant raw sensor readouts.
      set({ enabled: false, screenshot: false, loaded: true });
    }
  },

  setEnabled: async (value) => {
    set(value ? { enabled: true } : { enabled: false, screenshot: false });
    void logEvent('dev_mode_changed', { enabled: value });
    await writeSetting(KEY, value);
    if (!value) await writeSetting(SCREENSHOT_KEY, false);
    if (!value && (await clearDemoData())) {
      await useCheckinStore.getState().load();
    }
  },

  setScreenshot: async (value) => {
    const on = __DEV__ && value && useDevModeStore.getState().enabled;
    set({ screenshot: on });
    await writeSetting(SCREENSHOT_KEY, on);
    if (on) await seedScreenshotData();
    else await clearDemoData();
    await useCheckinStore.getState().load();
  },
}));

/** Waits for the stored setting, so a read during startup never takes "not loaded yet" for "off". */
export async function isDevModeEnabled(): Promise<boolean> {
  const state = useDevModeStore.getState();
  if (!state.loaded) await state.load();
  return useDevModeStore.getState().enabled;
}
