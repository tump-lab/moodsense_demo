/**
 * Research-consent step shown once right after sign-up (never on sign-in), with deliberately no way
 * past it without ticking the box.
 *
 * The streams are listed here, switched to their defaults, rather than only in Settings. Two
 * reasons, and neither is decoration: a consent form that does not show what it turns on is a
 * worse form, and a participant who never opens Settings used to never see this list at all. Every
 * stream starts on (CONSENT_DEFAULTS in ./pure.ts).
 *
 * Continuing writes whatever the switches say and saves an audit row of the agreement, then, on
 * iOS, walks the Screen Time grant and its pickers while the participant is still in a setup frame
 * of mind — see runScreenTimeSetup.
 *
 * Nothing on the far side of the agreement is allowed to hold the screen. Saving consent is the
 * only step that can fail visibly here: it is time-boxed and reports an error with a retry, because
 * an account whose agreement was not recorded has every stream read as off. The OS permission
 * sheets after it are best-effort and bounded — they used to be awaited unconditionally, and a
 * native callback that never arrived (a sheet that failed to present, a picker dismissed in a way
 * the bridge did not report) left "Agree and continue" spinning with no way forward.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackScreenProps } from '../../navigation';
import { withTimeout } from '../../services/async';
import { getActiveUid } from '../../services/firebase';
import { logEvent } from '../../services/logging';
import { primeSensingPermissions } from '../sensing/collectors';
import { CONSENT_DEFAULTS, useConsentStore, type ConsentFlags } from './store';
import { STREAMS } from './streams';
import { hasConsentAgreement, recordConsentAgreement } from './consentRecord';
import { resolveLocation } from '../community/resolveLocation';
import { placeToCommunityId, type Place } from '../community/communities';
import { getChosenCommunity, setChosenCommunity } from '../community/store';

/**
 * Budget for writing the agreement. Generous for four SQLite writes and one Firestore mirror, and
 * still short enough that a participant on a dead connection gets an error instead of a spinner.
 */
const SAVE_TIMEOUT_MS = 20_000;

/**
 * Ceiling on the explainer plus the Screen Time grant and its three pickers. Long, because it is
 * reading and tapping time, not latency — it is here only so the step cannot be the last thing that
 * ever happens on this screen.
 */
const SCREEN_TIME_TIMEOUT_MS = 8 * 60_000;

export default function ConsentOnboardingScreen({
  navigation,
}: RootStackScreenProps<'ConsentOnboarding'>) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /** Starts at the defaults, so doing nothing here consents to exactly what the form describes. */
  const [flags, setFlags] = useState<ConsentFlags>({ ...CONSENT_DEFAULTS });

  /** IP place lookup, started on mount so it is long finished by the time the participant agrees. */
  const placeLookup = useRef<Promise<Place | null> | null>(null);
  useEffect(() => {
    placeLookup.current = resolveLocation();
  }, []);

  /** Saves the resolved place as the community with no screen; false means ask manually. */
  const autoChooseCommunity = async (): Promise<boolean> => {
    try {
      if ((await getChosenCommunity()) != null) return true;
      const place = await placeLookup.current;
      if (place == null) return false;
      const communityId = placeToCommunityId(place);
      await setChosenCommunity(communityId);
      void logEvent('community_chosen', {
        communityId,
        countryId: place.countryCode,
        source: 'ip',
        isChange: false,
      });
      return true;
    } catch {
      return false;
    }
  };

  /** Everything that has to have happened before this screen may be left. */
  const saveConsent = async () => {
    const store = useConsentStore.getState();
    // Writes the defaults for a new account first, so every key has a row, then records the ones
    // the participant moved. acceptAllIfNew is a no-op on an account that already has rows.
    await store.acceptAllIfNew();
    for (const stream of STREAMS) {
      if (flags[stream.key] !== CONSENT_DEFAULTS[stream.key]) {
        await store.setConsent(stream.key, flags[stream.key]);
      }
    }
    await recordConsentAgreement();
    // Read back, because every write above swallows its own failure: they are all written to be
    // non-fatal where they are called from, which means a database that is not accepting writes
    // leaves this screen looking like it succeeded. It has not — the next load() finds no
    // agreement row and hydrates every stream to off (hydrateConsentFlags in ./pure.ts), so the
    // participant would carry on into an app that collects nothing and never says why. This is the
    // one place that can still tell them.
    if (!(await hasConsentAgreement(getActiveUid()))) {
      throw new Error('consent agreement was not stored');
    }
  };

  const continueOn = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setSaveError(false);

    try {
      await withTimeout(saveConsent(), SAVE_TIMEOUT_MS, 'consent save');
    } catch (err) {
      // The one failure worth stopping for: without an agreement on record every stream hydrates
      // to off, so going on would hand the participant an app that collects nothing and says
      // nothing about why.
      void logEvent('consent_onboarding_save_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setSaveError(true);
      setSubmitting(false);
      return;
    }

    // The gate every stream is read through; without this the switches just set would read as
    // off until the next load().
    useConsentStore.setState({ agreed: true });
    void logEvent('consent_onboarding_agreed', {
      off: STREAMS.filter((s) => !flags[s.key]).map((s) => s.key).join(','),
    });

    // The OS sheets the consent flags do not grant — health and motion — which otherwise only
    // appear if a poll happens to run while the app is foregrounded. Awaited rather than fired
    // off: the sheets are modal, and navigating out from under them would dismiss the one on
    // screen. primeSensingPermissions never rejects and is time-boxed internally, so however any
    // sheet goes, the next line still runs.
    //
    // Screen Time is left out of that call and run on its own below, because it needs its own
    // explainer first: the pickers ask the participant to sort their apps into groups, which is
    // not a question anyone can answer from a bare system sheet.
    await primeSensingPermissions({ includeScreenTime: false });
    const { runScreenTimeSetupIfUnset } = await import('../sensing/screenTimeSetup');
    await withTimeout(
      runScreenTimeSetupIfUnset(),
      SCREEN_TIME_TIMEOUT_MS,
      'screen time setup'
    ).catch((err) => {
      void logEvent('consent_onboarding_screen_time_incomplete', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

    if (await autoChooseCommunity()) navigation.replace('MainTabs');
    else navigation.replace('ChooseCommunity', { manual: true });
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.title}>One more thing</Text>
        <Text style={styles.subtitle}>
          MoodSense is here to help you understand your own wellbeing. Please
          read what data it collects and agree below before we turn on sensing
          for your account.
        </Text>

        <View style={styles.streams}>
          <Text style={styles.streamsTitle}>Data &amp; privacy</Text>
          <Text style={styles.streamsLead}>
            These are the streams MoodSense collects. They start on — you can turn any of
            them off now, or at any time from Settings.
          </Text>
          {STREAMS.map((stream) => (
            <View key={stream.key} style={styles.streamRow}>
              <View style={styles.streamText}>
                <Text style={styles.streamTitle}>{stream.title}</Text>
                <Text style={styles.streamSubtitle}>{stream.subtitle}</Text>
              </View>
              <Switch
                value={flags[stream.key]}
                onValueChange={(on) => setFlags((prev) => ({ ...prev, [stream.key]: on }))}
                accessibilityLabel={`${stream.title}: ${stream.subtitle}`}
                trackColor={{ true: colors.primarySoft, false: colors.surface2 }}
                thumbColor={flags[stream.key] ? colors.primary : undefined}
              />
            </View>
          ))}
        </View>

        <View style={styles.consentBlock}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I have read and agree to how MoodSense uses my data"
            onPress={() => setAgreed((v) => !v)}
            style={({ pressed }) => [
              styles.consentRow,
              pressed && styles.pressed,
            ]}
            hitSlop={6}
          >
            <Ionicons
              name={agreed ? 'checkbox' : 'square-outline'}
              size={22}
              color={agreed ? colors.primary : colors.ink3}
            />
            <Text style={styles.consentText}>
              I have read and agree to the MoodSense data &amp;
              privacy notice.
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => navigation.navigate('ConsentDetail')}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            hitSlop={6}
          >
            <Text style={styles.link}>Read details</Text>
          </Pressable>
        </View>

        {saveError && (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={18} color={colors.rose} />
            <Text style={styles.errorText}>
              We couldn&apos;t save your agreement on this device, so nothing has been turned on
              yet. Try again — if it keeps failing, restarting the app usually clears it.
            </Text>
          </View>
        )}

        <AppButton
          title={saveError ? 'Try again' : 'Agree and continue'}
          onPress={() => void continueOn()}
          disabled={!agreed || submitting}
          loading={submitting}
          style={styles.primaryBtn}
        />
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
  streams: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  streamsTitle: {
    ...type.h2,
    color: colors.ink,
  },
  streamsLead: {
    ...type.caption,
    color: colors.ink2,
    marginTop: 2,
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  streamText: {
    flex: 1,
  },
  streamTitle: {
    ...type.sub,
    color: colors.ink,
    fontWeight: '600',
  },
  streamSubtitle: {
    ...type.caption,
    color: colors.ink3,
    marginTop: 1,
    lineHeight: 15,
  },
  consentBlock: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  consentText: {
    ...type.sub,
    flex: 1,
    color: colors.ink2,
    lineHeight: 19,
  },
  linkRow: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    marginLeft: 22 + spacing.sm, // align under the consent text, past the box
  },
  link: {
    ...type.sub,
    color: colors.primaryDeep,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rose,
    backgroundColor: colors.roseSoft,
  },
  errorText: {
    ...type.sub,
    flex: 1,
    color: colors.ink,
    lineHeight: 19,
  },
  primaryBtn: {
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
});
