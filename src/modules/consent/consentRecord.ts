/**
 * Audit record of when an account agreed to the research-consent text and which version (CONSENT_TEXT_VERSION), saved once right after sign-up.
 * It is kept apart from consent_settings (./store.ts), which holds each stream's current on/off state and can change any time.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { exec, queryAll } from '../../services/db';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';
import { CONSENT_TEXT_VERSION } from './consentText';

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(
      `CREATE TABLE IF NOT EXISTS consent_records (
         uid TEXT PRIMARY KEY,
         version INTEGER NOT NULL,
         agreedAt INTEGER NOT NULL
       )`
    ).then(() => undefined);
  }
  return tableReady;
}

/** Persist that the active account just explicitly agreed to the current
 *  research-consent text — the audit trail behind the tick on
 *  ConsentOnboardingScreen. */
export async function recordConsentAgreement(): Promise<void> {
  const agreedAt = Date.now();
  try {
    await ensureTable();
    await exec(
      `INSERT INTO consent_records (uid, version, agreedAt) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET version = excluded.version, agreedAt = excluded.agreedAt`,
      [getActiveUid(), CONSENT_TEXT_VERSION, agreedAt]
    );
    mirrorAgreement(CONSENT_TEXT_VERSION, agreedAt);
  } catch {
    // Persistence failure is non-fatal here: acceptAllIfNew() already turned
    // the sensing streams on in the consent_settings table: this row is only
    // the audit trail of the tick itself.
  }
}

/**
 * Whether this uid has an agreement row yet — the gate store.ts's load()
 * uses to tell "never been through ConsentOnboarding" apart from "went
 * through it and a stream happens to be off". Fails closed (false) on a
 * read error, same as everywhere else sensing must not start without
 * confirmed consent.
 */
export async function hasConsentAgreement(uid: string): Promise<boolean> {
  try {
    await ensureTable();
    const rows = await queryAll<{ uid: string }>(
      'SELECT uid FROM consent_records WHERE uid = ?',
      [uid]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Best-effort copy of the agreement to the account's own document.
 *
 * The row is the gate store.ts's load() checks before it will let any stream read as on, and it
 * used to live only in this device's SQLite. An account is not a device: a participant who agreed
 * at sign-up and later signed in on a second phone, or reinstalled, arrived with no row, hydrated
 * to all-off, and could not fix it from Settings — every switch they turned on was discarded by
 * the next load(), because a stored row without an agreement is deliberately not read as consent.
 * Mirroring it is what makes the decision follow the account instead of the install.
 */
function mirrorAgreement(version: number, agreedAt: number): void {
  const db = getDb();
  if (!db) return;
  void (async () => {
    try {
      const user = await ensureSignedIn();
      if (!user) return;
      await setDoc(
        doc(db, 'users', user.uid),
        { consentVersion: version, consentAgreedAt: agreedAt },
        { merge: true }
      );
    } catch {
      // Local SQLite stays the source of truth; the next agreement re-mirrors.
    }
  })();
}

/**
 * Pulls an agreement made on another device into SQLite, so a signed-in account that consented
 * elsewhere is recognised here. No-op when Firebase is off or the session is anonymous — an
 * anonymous uid has no account document to have agreed on.
 *
 * Returns whether this uid has an agreement row once the sync has settled.
 */
export async function syncConsentAgreementFromCloud(): Promise<boolean> {
  const uid = getActiveUid();
  const db = getDb();
  if (!db || uid === 'local') return hasConsentAgreement(uid);
  try {
    const user = await ensureSignedIn();
    if (!user || user.uid !== uid) return hasConsentAgreement(uid);

    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.data() as
      | { consentVersion?: number; consentAgreedAt?: number }
      | undefined;
    if (!data?.consentAgreedAt) return hasConsentAgreement(uid);

    await ensureTable();
    await exec(
      `INSERT INTO consent_records (uid, version, agreedAt) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO NOTHING`,
      [uid, data.consentVersion ?? CONSENT_TEXT_VERSION, data.consentAgreedAt]
    );
    return true;
  } catch {
    return hasConsentAgreement(uid);
  }
}
