/**
 * Pure helpers for the Auth module.
 * Keep it free of React / Expo / Firebase imports so scripts/selfcheck-auth.ts can run it under plain Node.
 */

export interface AuthErrorLike {
  code?: string;
  message?: string;
}

export function friendlyAuthError(err: unknown): string {
  const code = (err as AuthErrorLike | null)?.code ?? '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account — try signing in instead.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/user-not-found':
      return 'No account found with that email.';
    case 'auth/account-exists-with-different-credential':
      // Firebase won't merge a Google sign-in with an existing password account for the same email.
      return 'That email already has an account created with a password — sign in with it instead.';
    case 'auth/network-request-failed':
      return 'No connection — check your network and try again.';
    default:
      return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }
}

export function canSubmitAuthForm(email: string, password: string): boolean {
  return email.trim().length > 0 && password.length >= 6;
}

/**
 * Sign-up also needs the data & privacy notice box ticked; there is deliberately no way to create an account without it.
 * Signing in has no such check, since that account already agreed when it was created.
 */
export function canSubmitSignUp(
  email: string,
  password: string,
  agreedToConsent: boolean
): boolean {
  return canSubmitAuthForm(email, password) && agreedToConsent;
}

export interface SessionUserLike {
  isAnonymous: boolean;
}

/** The anonymous session ensureSignedIn() creates before sign-up does not count as logged in. */
export function isRestorableSession(user: SessionUserLike | null): boolean {
  return !!user && !user.isAnonymous;
}

/**
 * RootNav's first-screen decision: offline, "signed in" means a local account exists on this device.
 * A fresh install always starts at Auth.
 */
export function resolveInitialRoute(
  useFirebase: boolean,
  isSessionRestorable: boolean,
  hasLocalAccount: boolean
): 'Auth' | 'MainTabs' {
  if (useFirebase) return isSessionRestorable ? 'MainTabs' : 'Auth';
  return hasLocalAccount ? 'MainTabs' : 'Auth';
}
