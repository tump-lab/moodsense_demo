/** No SQLite or Firebase imports here, so Node-only selfcheck scripts can import this file. */

export type ConsentKey =
  | 'motion'
  | 'screen'
  | 'health'
  | 'sleep'
  | 'appUsage'
  | 'calls';

export interface ConsentFlags {
  motion: boolean;
  screen: boolean;
  health: boolean;
  sleep: boolean;
  appUsage: boolean;
  calls: boolean;
}

export const CONSENT_DEFAULTS: ConsentFlags = {
  motion: true,
  screen: true,
  health: true,
  sleep: true,
  appUsage: true,
  // On by default: call length is a core study measure, and leaving it off meant a participant
  // who never opened Settings produced no call rows and no coverage spans at all, which reads in
  // the data as "never called" rather than "never listening".
  calls: true,
};

export const CONSENT_KEYS: ConsentKey[] = [
  'motion',
  'screen',
  'health',
  'sleep',
  'appUsage',
  'calls',
];

/**
 * Value acceptAllIfNew() writes for a new account. Reads CONSENT_DEFAULTS rather than hardcoding
 * anything, so the consent screen's switches and a new account's stored rows cannot drift apart.
 */
export function acceptAllIfNewValue(key: ConsentKey): boolean {
  return CONSENT_DEFAULTS[key];
}

/** A `consent_settings` row as read back from SQLite. */
export interface StoredConsentRow {
  key: string;
  value: number;
}

/**
 * Computes the consent flags store.ts's load() should hydrate from what's in
 * SQLite. `hasAgreementRecord` is whether a consent_records row (see
 * ./consentRecord.ts) exists for this uid — the audit trail written once
 * acceptAllIfNew()/recordConsentAgreement() run from ConsentOnboardingScreen.
 *
 * Without that row, every stream hydrates to false regardless of `rows`: an
 * account that has never completed ConsentOnboarding (a fresh install before
 * sign-in, or a sign-up abandoned mid-onboarding) must start with sensing
 * off, not CONSENT_DEFAULTS — CONSENT_DEFAULTS is only the fallback for a
 * *consented* account's stream that happens to have no explicit row.
 */
export function hydrateConsentFlags(
  hasAgreementRecord: boolean,
  rows: StoredConsentRow[]
): ConsentFlags {
  if (!hasAgreementRecord) {
    return CONSENT_KEYS.reduce((acc, key) => {
      acc[key] = false;
      return acc;
    }, {} as ConsentFlags);
  }
  const next: ConsentFlags = { ...CONSENT_DEFAULTS };
  for (const row of rows) {
    if ((CONSENT_KEYS as string[]).includes(row.key)) {
      next[row.key as ConsentKey] = row.value !== 0;
    }
  }
  return next;
}
