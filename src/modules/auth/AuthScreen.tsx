/**
 * Sign in or create an account before anything else; there is no path to MainTabs without completing one of the two forms.
 * Research consent is not collected here: it lives on ConsentOnboardingScreen, shown right after sign-up only, never after sign-in.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppButton, Card, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackScreenProps } from '../../navigation';
import {
  isGoogleSignInAvailable,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../../services/firebase';
import { logEvent } from '../../services/logging';
import { useConsentStore } from '../consent/store';
import { useLlmSettingsStore } from '../settings/llmSettings';
import { armSensingPermissionPrime } from '../sensing/SensingProvider';
import { canSubmitAuthForm, friendlyAuthError, type AuthErrorLike } from './pure';
import GoogleButton from './GoogleButton';

type Mode = 'signup' | 'signin';

const showGoogle = isGoogleSignInAvailable();

export default function AuthScreen({
  navigation,
}: RootStackScreenProps<'Auth'>) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'signup';
  const busy = submitting || googleSubmitting;

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email.trim(), password);
        void logEvent('auth_signup', { method: 'email' });
        navigation.replace('ConsentOnboarding');
      } else {
        await signInWithEmail(email.trim(), password);
        void logEvent('auth_signin', { method: 'email' });
        // Signing in is the one moment the OS sheets belong to: on iOS a reinstall clears every
        // grant, and nothing else re-asks. Arming rather than calling means they wait for the
        // consent flags to hydrate first (SensingProvider).
        armSensingPermissionPrime();
        // Drop consent and AI opt-in state cached from a previous account in this session, so this account's own flags are re-read.
        useConsentStore.getState().reset();
        useLlmSettingsStore.getState().reset();
        navigation.replace('MainTabs');
      }
    } catch (err) {
      // Non-PII: log only the Firebase error code, never the email or password.
      void logEvent(isSignUp ? 'auth_signup_failed' : 'auth_signin_failed', {
        method: 'email',
        code: (err as AuthErrorLike | null)?.code ?? null,
      });
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitGoogle = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      const result = await signInWithGoogle();
      // Null means the account sheet was dismissed. That is not a failure, so leave the screen as it was.
      if (!result) return;
      if (result.isNewAccount) {
        void logEvent('auth_signup', { method: 'google' });
        navigation.replace('ConsentOnboarding');
      } else {
        void logEvent('auth_signin', { method: 'google' });
        armSensingPermissionPrime();
        useConsentStore.getState().reset();
        useLlmSettingsStore.getState().reset();
        navigation.replace('MainTabs');
      }
    } catch (err) {
      void logEvent(isSignUp ? 'auth_signup_failed' : 'auth_signin_failed', {
        method: 'google',
        code: (err as AuthErrorLike | null)?.code ?? null,
      });
      setError(friendlyAuthError(err));
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const canSubmit = canSubmitAuthForm(email, password) && !busy;
  const canUseGoogle = !busy;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.title}>
          {isSignUp ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text style={styles.subtitle}>
          {/* Only promise Google when the button is actually rendered: showGoogle is false on any binary without the native module. */}
          {isSignUp
            ? showGoogle
              ? 'Use an email and password, or continue with Google.'
              : 'Use an email and password to get started.'
            : showGoogle
              ? 'Sign in with your email and password, or Google.'
              : 'Sign in with your email and password.'}
        </Text>

        <Card variant="white" style={styles.formCard}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            style={styles.input}
          />
          {/* Explicit content types stop iOS AutoFill from re-classifying the fields on every keystroke, which made the keyboard flash. */}
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password (at least 6 characters)"
            placeholderTextColor={colors.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="password"
            textContentType="password"
            secureTextEntry
            style={[styles.input, styles.inputLast]}
          />
        </Card>

        {error != null && <Text style={styles.error}>{error}</Text>}

        <AppButton
          title={isSignUp ? 'Create account' : 'Sign in'}
          onPress={() => void submit()}
          disabled={!canSubmit}
          loading={submitting}
          style={styles.primaryBtn}
        />

        {showGoogle && (
          <>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>
            <View style={styles.googleWrap}>
              <GoogleButton
                onPress={() => void submitGoogle()}
                disabled={!canUseGoogle}
                loading={googleSubmitting}
                label="Continue with Google"
              />
            </View>
          </>
        )}

        <AppButton
          title={
            isSignUp
              ? 'Already have an account? Sign in'
              : 'New here? Create an account'
          }
          variant="ghost"
          onPress={() => {
            setError(null);
            setMode((m) => (m === 'signup' ? 'signin' : 'signup'));
          }}
          style={styles.switchBtn}
        />

        <Text style={styles.fineText}>
          By continuing, you agree to our{' '}
          <Text
            accessibilityRole="link"
            style={styles.fineLink}
            onPress={() => navigation.navigate('Terms')}
          >
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text
            accessibilityRole="link"
            style={styles.fineLink}
            onPress={() => navigation.navigate('PrivacyPolicy')}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xxl,
  },
  title: {
    ...type.title,
    color: colors.ink,
    marginTop: spacing.xl,
  },
  subtitle: {
    ...type.body,
    color: colors.ink2,
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  formCard: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  dividerText: {
    ...type.sub,
    color: colors.ink3,
  },
  googleWrap: {
    marginTop: spacing.md,
  },
  input: {
    ...type.body,
    color: colors.ink,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  inputLast: {
    borderBottomWidth: 0,
  },
  error: {
    ...type.sub,
    color: colors.rose,
    marginTop: spacing.md,
  },
  primaryBtn: {
    marginTop: spacing.xl,
  },
  switchBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.pill,
  },
  fineText: {
    ...type.sub,
    color: colors.ink3,
    marginTop: spacing.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
  fineLink: {
    color: colors.primaryDeep,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
