import { create } from 'zustand';
import { exec, queryAll } from '../../services/db';
import { getActiveUid } from '../../services/firebase';
import { logEvent } from '../../services/logging';
import { hasConsentAgreement, syncConsentAgreementFromCloud } from './consentRecord';
import {
  acceptAllIfNewValue,
  CONSENT_DEFAULTS,
  CONSENT_KEYS,
  hydrateConsentFlags,
  type ConsentFlags,
  type ConsentKey,
} from './pure';

export type { ConsentFlags, ConsentKey };
export { CONSENT_DEFAULTS };

export interface ConsentState extends ConsentFlags {
  loaded: boolean;
  /**
   * Whether this account has an agreement on record, locally or in the cloud. Every stream reads
   * as off while this is false, however many rows consent_settings holds, so a screen offering
   * switches has to know: without it, Settings shows controls whose value the next load() throws
   * away.
   */
  agreed: boolean;
  load: () => Promise<void>;
  setConsent: (key: ConsentKey, value: boolean) => Promise<void>;
  /**
   * Writes CONSENT_DEFAULTS for a brand-new account only. A returning account already has rows
   * and keeps them, so a stream it turned off is never switched back on.
   */
  acceptAllIfNew: () => Promise<void>;
  /**
   * Call on sign-out and on sign-in to an existing account, so the next account re-reads its own
   * rows. SensingProvider only re-runs load() when `loaded` goes back to false.
   */
  reset: () => void;
}

async function ensureTable(): Promise<void> {
  await exec(
    'CREATE TABLE IF NOT EXISTS consent_settings (key TEXT PRIMARY KEY, value INTEGER)'
  );
  await migrateUidScoping();
}

async function hasUidColumn(): Promise<boolean> {
  const rows = await queryAll<{ name: string }>('PRAGMA table_info(consent_settings)');
  return rows.some((r) => r.name === 'uid');
}

/**
 * Adds the uid column to an older table. SQLite cannot change a PRIMARY KEY with ALTER TABLE,
 * so the table is rebuilt and old rows get uid='local'.
 */
async function migrateUidScoping(): Promise<void> {
  if (await hasUidColumn()) return;
  await exec('ALTER TABLE consent_settings RENAME TO consent_settings_old');
  await exec(`CREATE TABLE consent_settings (
    key TEXT NOT NULL,
    value INTEGER,
    uid TEXT NOT NULL DEFAULT 'local',
    PRIMARY KEY (key, uid)
  )`);
  await exec(
    `INSERT INTO consent_settings (key, value, uid) SELECT key, value, 'local' FROM consent_settings_old`
  );
  await exec('DROP TABLE consent_settings_old');
}

export const useConsentStore = create<ConsentState>((set) => ({
  ...CONSENT_DEFAULTS,
  loaded: false,
  agreed: false,

  load: async () => {
    try {
      await ensureTable();
      const uid = getActiveUid();
      const [rows, agreedLocally] = await Promise.all([
        queryAll<{ key: string; value: number }>(
          'SELECT key, value FROM consent_settings WHERE uid = ?',
          [uid]
        ),
        hasConsentAgreement(uid),
      ]);
      // An account that agreed on another device — or on this one before a reinstall — has no
      // local row, and without this would hydrate to all-off with no way back: Settings would
      // accept a switch and the next load() would discard it, because a stored row on its own is
      // deliberately not read as consent. The cloud copy is what makes the decision belong to the
      // account rather than the install. Only consulted when the local row is missing, so the
      // usual path still costs nothing.
      const agreed = agreedLocally || (await syncConsentAgreementFromCloud());
      set({ ...hydrateConsentFlags(agreed, rows), loaded: true, agreed });
    } catch {
      // DB unavailable — fail closed rather than defaulting streams on: with
      // no way to confirm this uid ever agreed, "unknown" must read as "not
      // consented", same as a missing consent_records row.
      set({ ...hydrateConsentFlags(false, []), loaded: true, agreed: false });
    }
  },

  setConsent: async (key, value) => {
    set({ [key]: value } as Partial<ConsentState>);
    void logEvent('consent_changed', { key, enabled: value });
    try {
      await ensureTable();
      await exec(
        `INSERT INTO consent_settings (key, value, uid) VALUES (?, ?, ?)
         ON CONFLICT(key, uid) DO UPDATE SET value = excluded.value`,
        [key, value ? 1 : 0, getActiveUid()]
      );
    } catch {
      // Not fatal: the in-memory value still controls sensing.
    }
  },

  acceptAllIfNew: async () => {
    try {
      await ensureTable();
      const uid = getActiveUid();
      const existing = await queryAll<{ key: string }>(
        'SELECT key FROM consent_settings WHERE uid = ?',
        [uid]
      );
      if (existing.length > 0) return;

      for (const key of CONSENT_KEYS) {
        await exec(
          `INSERT INTO consent_settings (key, value, uid) VALUES (?, ?, ?)
           ON CONFLICT(key, uid) DO UPDATE SET value = excluded.value`,
          [key, acceptAllIfNewValue(key) ? 1 : 0, uid]
        );
      }
      set(
        CONSENT_KEYS.reduce((acc, key) => {
          acc[key] = acceptAllIfNewValue(key);
          return acc;
        }, {} as ConsentFlags)
      );
    } catch {
      // Not fatal: CONSENT_DEFAULTS already apply until load() next succeeds.
    }
  },

  reset: () => set({ ...CONSENT_DEFAULTS, loaded: false, agreed: false }),
}));

export function hasConsent(key: ConsentKey): boolean {
  return useConsentStore.getState()[key];
}
