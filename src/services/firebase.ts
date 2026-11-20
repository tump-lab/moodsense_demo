import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { CONFIG } from '../config';
import { clearOrphanedLocalRows, exec, queryAll, reattachOrphanedLocalRows } from './db';
import { isRestorableSession as pureIsRestorableSession } from '../modules/auth/pure';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  EmailAuthProvider,
  getAdditionalUserInfo,
  getAuth,
  deleteUser,
  GoogleAuthProvider,
  getReactNativePersistence,
  initializeAuth,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  User,
} from '@firebase/auth';
import { connectFirestoreEmulator, Firestore, getFirestore, initializeFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

function getApp(): FirebaseApp | null {
  if (!CONFIG.USE_FIREBASE) return null;
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return app;
}

export function getDb(): Firestore | null {
  if (!CONFIG.USE_FIREBASE) return null;
  if (!db) {
    const a = getApp();
    if (!a) return null;
    // On iOS/Android, React Native buffers Firestore's streaming connection, so onSnapshot gets its
    // first read but never hears about later server writes (Guide's replies, other members' group
    // messages). Long polling delivers them. initializeFirestore throws if called twice, hence the fallback.
    try {
      db =
        Platform.OS === 'web'
          ? getFirestore(a)
          : initializeFirestore(a, { experimentalForceLongPolling: true });
    } catch {
      db = getFirestore(a);
    }
    // Dev only: e.g. EXPO_PUBLIC_FIRESTORE_EMULATOR=127.0.0.1:8089 to try rules or screens before deploying them.
    const emulator = process.env.EXPO_PUBLIC_FIRESTORE_EMULATOR;
    if (__DEV__ && emulator) {
      const [host, port] = emulator.split(':');
      connectFirestoreEmulator(db, host!, Number(port));
    }
  }
  return db;
}

export function getStorageInstance(): FirebaseStorage | null {
  if (!CONFIG.USE_FIREBASE) return null;
  if (!firebaseConfig.storageBucket) return null;
  if (!storage) {
    const a = getApp();
    if (!a) return null;
    storage = getStorage(a);
  }
  return storage;
}

/** The signed-in user's ID token, sent to the Cloudflare Worker (see services/api.ts) as proof of who is calling. Null when signed out or Firebase is off. */
export async function getIdToken(): Promise<string | null> {
  const user = getAuthInstance()?.currentUser ?? null;
  return user ? user.getIdToken() : null;
}

/**
 * On native, plain getAuth() keeps auth in memory only and Firestore can fail with
 * "Missing or insufficient permissions" right after sign-in, so we use initializeAuth() with AsyncStorage.
 * On web, getReactNativePersistence is undefined at runtime, so web uses getAuth() as is.
 */
function getAuthInstance(): Auth | null {
  if (!CONFIG.USE_FIREBASE) return null;
  const a = getApp();
  if (!a) return null;
  if (!auth) {
    auth =
      Platform.OS === 'web'
        ? getAuth(a)
        : initializeAuth(a, {
            persistence: getReactNativePersistence(ReactNativeAsyncStorage),
          });
  }
  return auth;
}

/**
 * Wait for the persisted session to load before signing in anonymously.
 * Calling signInAnonymously() while currentUser is still null mints a new anonymous user and overwrites the real restored session.
 */
export async function ensureSignedIn(): Promise<User | null> {
  const a = getAuthInstance();
  if (!a) return null;
  const restored = await waitForAuthState();
  if (restored) return restored;
  const cred = await signInAnonymously(a);
  return cred.user;
}

/**
 * Calls back with the active uid now and again whenever it changes, including the moment the
 * persisted session finishes restoring.
 *
 * Every per-account store keys its rows on `getActiveUid()`, and that answers `'local'` until
 * Firebase has restored the session — which it does asynchronously, a beat after launch. A store
 * that hydrates on mount therefore reads `'local'`'s rows (there are none), concludes the account
 * has consented to nothing and has AI off, and never looks again, because its own `loaded` flag is
 * now true. Subscribing instead of reading once is what lets it re-read against the real account.
 *
 * Returns an unsubscribe. With Firebase off, the uid is `'local'` for the life of the process, so
 * this fires once and never again.
 */
export function subscribeActiveUid(onUid: (uid: string) => void): () => void {
  if (!CONFIG.USE_FIREBASE) {
    onUid('local');
    return () => {};
  }
  const a = getAuthInstance();
  if (!a) {
    onUid('local');
    return () => {};
  }
  return onAuthStateChanged(a, (user) => onUid(user ? user.uid : 'local'));
}

export function waitForAuthState(): Promise<User | null> {
  const a = getAuthInstance();
  if (!a) return Promise.resolve(null);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(a, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export function isRestorableSession(user: User | null): boolean {
  return pureIsRestorableSession(user);
}

export function hasRealSession(): boolean {
  return isRestorableSession(getAuthInstance()?.currentUser ?? null);
}

export function getActiveUid(): string {
  if (!CONFIG.USE_FIREBASE) return 'local';
  const user = getAuthInstance()?.currentUser ?? null;
  return user ? user.uid : 'local';
}

interface LocalAccountRow {
  email: string;
  password_hash: string;
  salt: string;
}

async function hasSaltColumn(): Promise<boolean> {
  const rows = await queryAll<{ name: string }>('PRAGMA table_info(local_auth_account)');
  return rows.some((r) => r.name === 'salt');
}

/**
 * An older version of this table stored the password in plain text.
 * A table in that old shape is dropped and rebuilt empty, so the user just registers again.
 */
async function ensureLocalAuthTable(): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS local_auth_account (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       email TEXT NOT NULL,
       password_hash TEXT NOT NULL,
       salt TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`
  );
  if (!(await hasSaltColumn())) {
    await exec('DROP TABLE local_auth_account');
    await exec(
      `CREATE TABLE local_auth_account (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         email TEXT NOT NULL,
         password_hash TEXT NOT NULL,
         salt TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`
    );
  }
}

async function generateSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

async function readLocalAccount(): Promise<LocalAccountRow | null> {
  await ensureLocalAuthTable();
  const rows = await queryAll<LocalAccountRow>(
    'SELECT email, password_hash, salt FROM local_auth_account WHERE id = 1'
  );
  return rows[0] ?? null;
}

export async function hasLocalAccount(): Promise<boolean> {
  return (await readLocalAccount()) != null;
}

async function createLocalAccount(email: string, password: string): Promise<void> {
  if (password.length < 6) {
    throw { code: 'auth/weak-password' };
  }
  const existing = await readLocalAccount();
  if (existing) {
    throw { code: 'auth/email-already-in-use' };
  }
  await ensureLocalAuthTable();
  const salt = await generateSalt();
  const passwordHash = await hashPassword(password, salt);
  await exec(
    `INSERT INTO local_auth_account (id, email, password_hash, salt, created_at) VALUES (1, ?, ?, ?, ?)`,
    [email, passwordHash, salt, Date.now()]
  );
}

async function verifyLocalAccount(email: string, password: string): Promise<void> {
  const account = await readLocalAccount();
  if (!account || account.email.toLowerCase() !== email.toLowerCase()) {
    throw { code: 'auth/user-not-found' };
  }
  const passwordHash = await hashPassword(password, account.salt);
  if (passwordHash !== account.password_hash) {
    throw { code: 'auth/wrong-password' };
  }
}

export async function signUpWithEmail(
  email: string,
  password: string
): Promise<User | null> {
  if (!CONFIG.USE_FIREBASE) {
    await createLocalAccount(email, password);
    return null;
  }
  let anon = await ensureSignedIn();
  if (anon && !anon.isAnonymous) {
    // A restored real session must never be linked to: that would attach the new email to the old account and show its data.
    await signOut();
    anon = await ensureSignedIn();
  }
  if (!anon) {
    throw new Error('Could not establish a session to link the account to.');
  }
  const credential = EmailAuthProvider.credential(email, password);
  const result = await linkWithCredential(anon, credential);
  await reattachOrphanedLocalRows(result.user.uid);
  return result.user;
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<User | null> {
  if (!CONFIG.USE_FIREBASE) {
    await verifyLocalAccount(email, password);
    return null;
  }
  const a = getAuthInstance();
  if (!a) throw new Error('Firebase is not configured — cannot sign in.');
  const result = await signInWithEmailAndPassword(a, email, password);
  return result.user;
}

export interface GoogleSignInResult {
  user: User;
  isNewAccount: boolean;
}

/**
 * Loaded on demand: a static import throws at startup on any binary without the native module (Expo Go, older builds).
 * Requiring it lazily keeps that failure local to the Google button.
 */
type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

let googleSignInModule: GoogleSignInModule | null | undefined;

function getGoogleSignInModule(): GoogleSignInModule | null {
  if (googleSignInModule === undefined) {
    try {
      googleSignInModule = require('@react-native-google-signin/google-signin');
    } catch {
      googleSignInModule = null;
    }
  }
  return googleSignInModule ?? null;
}

function requireGoogleSignInModule(): GoogleSignInModule {
  const mod = getGoogleSignInModule();
  if (!mod) {
    throw new Error(
      'Google sign-in is unavailable in this build. Rebuild the app (expo run:ios / run:android, or a new EAS build) so the native module is included.'
    );
  }
  return mod;
}

export function isGoogleSignInAvailable(): boolean {
  return CONFIG.USE_GOOGLE_SIGNIN && getGoogleSignInModule() !== null;
}

let googleConfigured = false;

/**
 * Without webClientId the native sheet still succeeds but idToken comes back null, and the Firebase exchange fails.
 */
function configureGoogleSignIn(google: GoogleSignInModule): void {
  if (googleConfigured) return;
  google.GoogleSignin.configure({
    webClientId: CONFIG.GOOGLE_WEB_CLIENT_ID,
    iosClientId: CONFIG.GOOGLE_IOS_CLIENT_ID || undefined,
    offlineAccess: false,
  });
  googleConfigured = true;
}

export async function signInWithGoogle(): Promise<GoogleSignInResult | null> {
  if (!CONFIG.USE_GOOGLE_SIGNIN) {
    throw new Error('Google sign-in is not configured for this build.');
  }
  const a = getAuthInstance();
  if (!a) throw new Error('Firebase is not configured — cannot sign in.');

  const google = requireGoogleSignInModule();
  configureGoogleSignIn(google);
  await google.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let response;
  try {
    response = await google.GoogleSignin.signIn();
  } catch (err) {
    if (google.isErrorWithCode(err) && err.code === google.statusCodes.SIGN_IN_CANCELLED) {
      return null;
    }
    throw err;
  }
  if (response.type !== 'success') return null;

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error(
      'Google did not return an ID token — check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.'
    );
  }

  const credential = GoogleAuthProvider.credential(idToken);
  const anon = await ensureSignedIn();

  if (anon?.isAnonymous) {
    try {
      const linked = await linkWithCredential(anon, credential);
      await reattachOrphanedLocalRows(linked.user.uid);
      return { user: linked.user, isNewAccount: true };
    } catch (err) {
      if (!isCredentialInUse(err)) throw err;
    }
  }

  const result = await signInWithCredential(a, credential);
  return {
    user: result.user,
    isNewAccount: getAdditionalUserInfo(result)?.isNewUser ?? false,
  };
}

function isCredentialInUse(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use'
  );
}

export async function signOut(): Promise<void> {
  if (CONFIG.USE_GOOGLE_SIGNIN) {
    try {
      await getGoogleSignInModule()?.GoogleSignin.signOut();
    } catch {
    }
  }
  if (!CONFIG.USE_FIREBASE) return;
  const a = getAuthInstance();
  if (!a) return;
  await firebaseSignOut(a);
  // Anything left under 'local' belongs to nobody; drop it so the next account on this device can't see it.
  await clearOrphanedLocalRows().catch(() => {});
}

/** Deletes the signed-in Firebase account itself. Throws `auth/requires-recent-login` when the session is too old; the caller tells the person to sign in again. */
export async function deleteCurrentAccount(): Promise<void> {
  const user = getAuthInstance()?.currentUser ?? null;
  if (!user) return;
  await deleteUser(user);
  if (CONFIG.USE_GOOGLE_SIGNIN) {
    try {
      await getGoogleSignInModule()?.GoogleSignin.signOut();
    } catch {
    }
  }
}
