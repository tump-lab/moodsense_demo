/**
 * Per-stream research-consent toggles, plus the full consent text, Terms and Privacy Policy.
 * Every collector re-checks consent at sample time, so flipping a switch here takes effect immediately.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Pill, Row, Screen } from '../../components';
import { colors, spacing, type } from '../../theme';
import { queryAll } from '../../services/db';
import { CONFIG } from '../../config';
import {
  deleteCurrentAccount,
  getActiveUid,
  hasRealSession,
  signOut,
} from '../../services/firebase';
import { apiPost, hasApi } from '../../services/api';
import { logEvent } from '../../services/logging';
import type { RootStackParamList } from '../../navigation';
import { useConsentStore } from '../consent/store';
import { STREAMS } from '../consent/streams';
import { usePhq4CadenceStore } from '../phq4/cadence';
import { getUploadStatus, wearableDataPresence, type UploadStatus } from '../sensing/queue';
import {
  getHealthStreamStatus,
  syncIosUsageMonitoring,
  type HealthStreamStatus,
} from '../sensing/collectors';
import * as iosUsage from '../../../modules/moodsense-ios-usage';
import { useDevModeStore } from './devMode';
import { useLlmSettingsStore } from './llmSettings';
import { useCheckinStore } from '../checkin/store';

function relativeTime(ts: number | null): string {
  if (ts == null) return 'never';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const USAGE_PICKER_ROWS: {
  category: iosUsage.UsageCategory;
  emoji: string;
  iconBg: string;
  title: string;
}[] = [
  // iOS has no API for whole-device screen time, so a selection holding every category stands in for "the whole phone".
  // The subtitle has to ask for exactly that, or the number quietly means something narrower.
  { category: 'total', emoji: '\u{1F4F1}', iconBg: colors.amberSoft, title: 'Screen time' },
];

// This build has no location background mode, so MoodSense hears only what overlaps the
// moments it happens to be awake. Shown as "unavailable" rather than hidden, so an empty row
// is not read as a quiet day.
function keepAliveTitle(status: iosUsage.CallKeepAliveStatus): string {
  return status === 'unavailable' ? 'Location unavailable' : 'Location';
}

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const consent = useConsentStore();
  const cadence = usePhq4CadenceStore((s) => s.cadence);
  const setCadence = usePhq4CadenceStore((s) => s.setCadence);
  const devMode = useDevModeStore((s) => s.enabled);
  const setDevMode = useDevModeStore((s) => s.setEnabled);
  const screenshotMode = useDevModeStore((s) => s.screenshot);
  const setScreenshotMode = useDevModeStore((s) => s.setScreenshot);
  const llmEnabled = useLlmSettingsStore((s) => s.enabled);
  const setLlmEnabled = useLlmSettingsStore((s) => s.setEnabled);
  const [sensingCount, setSensingCount] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [hasWearableData, setHasWearableData] = useState(true);
  const [healthStatus, setHealthStatus] = useState<HealthStreamStatus>(getHealthStreamStatus);
  const [screenTime, setScreenTime] = useState<{
    status: iosUsage.ScreenTimeAuthorizationStatus;
    summary: iosUsage.SelectionSummary;
  } | null>(null);
  const [screenTimeBusy, setScreenTimeBusy] = useState(false);
  const [callKeepAlive, setCallKeepAlive] = useState<iosUsage.CallKeepAliveStatus | null>(null);
  const [callKeepAliveBusy, setCallKeepAliveBusy] = useState(false);

  const refreshScreenTime = useCallback(async () => {
    if (!iosUsage.isScreenTimeConfigured) return;
    const [status, summary] = await Promise.all([
      iosUsage.screenTimeAuthorizationStatus(),
      iosUsage.selectionSummary(),
    ]);
    setScreenTime({ status, summary });
  }, []);

  const refreshCallKeepAlive = useCallback(async () => {
    if (!iosUsage.isAvailable) return;
    setCallKeepAlive(await iosUsage.callKeepAliveStatus());
  }, []);

  // Re-read on return to the app: "While Using" can only become "Always" in iOS Settings.
  useEffect(() => {
    void refreshCallKeepAlive().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshCallKeepAlive().catch(() => {});
    });
    return () => sub.remove();
  }, [refreshCallKeepAlive]);

  useEffect(() => {
    void useConsentStore.getState().load();
    void usePhq4CadenceStore.getState().load();
    void useDevModeStore.getState().load();
    void useLlmSettingsStore.getState().load();
    void queryAll<{ c: number }>(
      'SELECT COUNT(*) AS c FROM sensing_events WHERE uid = ?',
      [getActiveUid()]
    )
      .then((rows) => setSensingCount(rows[0]?.c ?? 0))
      .catch(() => {});
    void getUploadStatus().then(setUploadStatus).catch(() => {});
    void refreshScreenTime().catch(() => {});
    void wearableDataPresence()
      .then((p) => setHasWearableData(p.heartRate || p.sleep))
      .catch(() => {});
    // Polled rather than read once: the first health poll fires around the time this screen mounts, so a single read usually catches 'idle' and never updates.
    const statusTimer = setInterval(() => setHealthStatus(getHealthStreamStatus()), 2_000);
    return () => clearInterval(statusTimer);
  }, [refreshScreenTime]);

  const HEALTH_STATE_TEXT: Record<HealthStreamStatus['state'], string> = {
    idle: 'Waiting for first read',
    consent_off: 'Turned off',
    no_native_module: 'HealthKit not in this build',
    init_failed: 'HealthKit would not open',
    read_failed: 'Last read failed',
    no_samples: 'Last read was empty',
    ok: 'Working',
  };
  const healthWorking = healthStatus.state === 'ok';

  // Only shown once the collector is known to be reading; otherwise this told someone whose Health app is full of heart rate to go pair a watch, when the real problem was on our side.
  const showWearableHint =
    (consent.health || consent.sleep) && !hasWearableData && healthWorking;

  /** Deletes everything stored on our servers for this account (check-ins, PHQ-4, chats, sensing data, old voice notes). The account itself stays. */
  const deleteRemoteData = async (): Promise<boolean> => {
    if (!hasApi()) return false;
    try {
      await apiPost('/delete', {}, 60_000);
      return true;
    } catch (err) {
      Alert.alert(
        'Could not delete your data',
        err instanceof Error ? err.message : 'Something went wrong and nothing was deleted. Please try again.'
      );
      return false;
    }
  };

  const handleDeleteData = () => {
    Alert.alert(
      'Delete my data',
      'This deletes your check-ins, chats and sensing data from our servers. Your account stays. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete data',
          style: 'destructive',
          onPress: () =>
            void deleteRemoteData().then((ok) => {
              if (!ok) return;
              void logEvent('delete_remote_data');
              Alert.alert('Done', 'Your data has been deleted.');
            }),
        },
      ]
    );
  };

  const performDeleteAccount = async () => {
    if (!(await deleteRemoteData())) return;
    try {
      void logEvent('delete_account');
      await deleteCurrentAccount();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      Alert.alert(
        'Please sign in again',
        code === 'auth/requires-recent-login'
          ? 'Your data is deleted. To finish deleting your account, sign out, sign back in, and try again.'
          : 'Your data is deleted, but the account could not be removed. Please try again.'
      );
      return;
    }
    await signOut().catch(() => {});
    useConsentStore.getState().reset();
    useCheckinStore.getState().reset();
    useLlmSettingsStore.getState().reset();
    navigation
      .getParent<NativeStackNavigationProp<RootStackParamList>>()
      ?.reset({ index: 0, routes: [{ name: 'Auth' }] });
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete my account',
      'This deletes your account and all of your data from our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void performDeleteAccount() },
      ]
    );
  };

  const handleManageData = () => {
    Alert.alert('Delete', undefined, [
      { text: 'Delete my data', onPress: handleDeleteData },
      { text: 'Delete my account', style: 'destructive', onPress: handleDeleteAccount },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const showScreenTime =
    iosUsage.isScreenTimeConfigured &&
    consent.appUsage &&
    screenTime != null &&
    screenTime.status !== 'unavailable';
  const showKeepAlive = Platform.OS === 'ios' && (consent.calls || consent.screen) && callKeepAlive != null;

  return (
    <Screen edges={[]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.title}>Data & privacy</Text>

        {/* Without an agreement on record every stream reads as off whatever consent_settings
            holds, so these switches would accept a tap and lose it at the next load(). Sending
            them to the consent screen is the only thing that can actually turn a stream on. */}
        {consent.loaded && !consent.agreed ? (
          <Card variant="white" style={styles.togglesCard}>
            <Row
              icon={<Text style={styles.rowEmoji}>{'\u{1F4CB}'}</Text>}
              iconBg={colors.surface2}
              title="Finish setting up"
              onPress={() => navigation.navigate('ConsentOnboarding')}
            />
          </Card>
        ) : (
        <Card variant="white" style={styles.togglesCard}>
          {STREAMS.map((s, i) => (
            <Row
              key={s.key}
              icon={<Text style={styles.rowEmoji}>{s.emoji}</Text>}
              iconBg={s.iconBg}
              title={s.title}
              right={
                <Switch
                  value={consent[s.key]}
                  onValueChange={(v) => void consent.setConsent(s.key, v)}
                  trackColor={{ false: colors.line, true: colors.primary }}
                  thumbColor={colors.surface}
                />
              }
              style={i < STREAMS.length - 1 || showScreenTime || showKeepAlive ? styles.rowDivider : undefined}
            />
          ))}

        {/* Only rendered on a build with the Family Controls entitlement and while app-usage consent is on; elsewhere the rows are absent rather than disabled. They sit in the same list as the switches above.
            iOS hands back opaque app tokens, so the participant supplies the labels by picking apps twice (see ../sensing/iosUsage.ts). */}
        {showScreenTime && screenTime != null && (
            <>
                {screenTime.status !== 'approved' ? (
                  <Row
                    icon={<Text style={styles.rowEmoji}>{'\u{23F3}'}</Text>}
                    iconBg={colors.surface2}
                    style={showKeepAlive ? styles.rowDivider : undefined}
                    title={
                      screenTime.status === 'denied'
                        ? 'Screen time turned down'
                        : 'Screen time'
                    }
                    subtitle={
                      screenTime.status === 'denied'
                        ? 'Not being recorded. You can allow it again from iOS Settings \u203A Screen Time.'
                        : undefined
                    }
                    right={
                      screenTime.status === 'notDetermined' ? (
                        <AppButton
                          title="Allow"
                          variant="ghost"
                          onPress={() => {
                            if (screenTimeBusy) return;
                            setScreenTimeBusy(true);
                            void iosUsage
                              .requestScreenTimeAuthorization()
                              .then((status) => {
                                void logEvent('screen_time_authorization', { status });
                                return refreshScreenTime();
                              })
                              .catch((err) => {
                                void logEvent('screen_time_authorization_failed', {
                                  error: err instanceof Error ? err.message : String(err),
                                });
                              })
                              .finally(() => setScreenTimeBusy(false));
                          }}
                        />
                      ) : (
                        <Pill label="OFF" />
                      )
                    }
                  />
                ) : (
                  // Switch mirrors the "App usage stats" consent toggle above: off stops recording
                  // (the outer `consent.appUsage` gate then hides this whole block), on reopens the
                  // app-selection picker since this branch only renders once permission is already
                  // approved; the permission-request flow itself still lives in the branch above.
                  USAGE_PICKER_ROWS.map((row, i) => {
                    const openPicker = () => {
                      if (screenTimeBusy) return;
                      setScreenTimeBusy(true);
                      void iosUsage
                        .presentActivityPicker(row.category)
                        .then((result) => {
                          // A picker that refuses to open reports a reason here and nowhere else.
                          void logEvent('screen_time_picker', {
                            category: row.category,
                            cancelled: result.cancelled,
                            reason: result.reason,
                            chosen: result[row.category],
                          });
                          return syncIosUsageMonitoring();
                        })
                        .then(() => refreshScreenTime())
                        .catch((err) => {
                          void logEvent('screen_time_picker_failed', {
                            category: row.category,
                            error: err instanceof Error ? err.message : String(err),
                          });
                        })
                        .finally(() => setScreenTimeBusy(false));
                    };
                    return (
                      <Row
                        key={row.category}
                        icon={<Text style={styles.rowEmoji}>{row.emoji}</Text>}
                        iconBg={row.iconBg}
                        title={row.title}
                        right={
                          <Switch
                            value={consent.appUsage}
                            onValueChange={(v) => (v ? openPicker() : void consent.setConsent('appUsage', false))}
                            trackColor={{ false: colors.line, true: colors.primary }}
                            thumbColor={colors.surface}
                          />
                        }
                        onPress={openPicker}
                        style={i < USAGE_PICKER_ROWS.length - 1 || showKeepAlive ? styles.rowDivider : undefined}
                      />
                    );
                  })
                )}
            </>
          )}

        {/* iOS reports calls and unlocks only while MoodSense is running; this is where the participant lets it keep running (see CallSensing.swift). Same list as the switches above. */}
        {showKeepAlive && callKeepAlive != null && (
              <>
                <Row
                  icon={<Text style={styles.rowEmoji}>{'\u{1F4CD}'}</Text>}
                  iconBg={colors.surface2}
                  title={keepAliveTitle(callKeepAlive)}
                  right={
                    callKeepAlive === 'always' ? (
                      // Green like the rows above. iOS has no in-app way to revoke location, so
                      // switching it off sends the user to Settings to do it there.
                      <Switch
                        value
                        onValueChange={(v) => {
                          if (!v) void Linking.openSettings();
                        }}
                        trackColor={{ false: colors.line, true: colors.primary }}
                        thumbColor={colors.surface}
                      />
                    ) : callKeepAlive === 'unavailable' ? (
                      <Pill label="OFF" />
                    ) : (
                      <AppButton
                        title={callKeepAlive === 'notDetermined' ? 'Allow' : 'Settings'}
                        variant="ghost"
                        onPress={() => {
                          if (callKeepAlive !== 'notDetermined') {
                            void Linking.openSettings();
                            return;
                          }
                          if (callKeepAliveBusy) return;
                          setCallKeepAliveBusy(true);
                          void iosUsage
                            .requestCallKeepAlive()
                            .then(setCallKeepAlive)
                            .catch(() => {})
                            .finally(() => setCallKeepAliveBusy(false));
                        }}
                      />
                    )
                  }
                />
              </>
          )}
        </Card>
        )}

        <Text style={styles.sectionTitle}>Preferences</Text>
        <Card variant="white" style={styles.togglesCard}>
          <Row
            icon={<Text style={styles.rowEmoji}>{'\u2728'}</Text>}
            iconBg={colors.primarySoft}
            title="Use Artificial Intelligence"
            right={
              <Switch
                value={llmEnabled}
                onValueChange={(v) => void setLlmEnabled(v)}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor={colors.surface}
              />
            }
            style={styles.rowDivider}
          />
          <Row
            icon={<Text style={styles.rowEmoji}>{'\u{1F4CB}'}</Text>}
            title="Mood Check every day"
            right={
              <Switch
                value={cadence === 'daily'}
                onValueChange={(v) => void setCadence(v ? 'daily' : 'weekly')}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor={colors.surface}
              />
            }
          />
        </Card>

        <Text style={styles.sectionTitle}>About</Text>
        <Card variant="white" style={styles.togglesCard}>
          <Row
            icon={<Text style={styles.rowEmoji}>{'\u{1F4C4}'}</Text>}
            title="Terms & privacy"
            onPress={() => navigation.navigate('TermsPrivacy')}
            right={<Ionicons name="chevron-forward" size={20} color={colors.ink3} />}
          />
        </Card>

        <Text style={styles.sectionTitle}>Developer</Text>
        <Card style={styles.rowCard}>
          {devMode && (
          <Row
            icon={<Text style={styles.rowEmoji}>{'\u{1F4E1}'}</Text>}
            title="Sensing active"
            subtitle={`${sensingCount} events collected on this device`}
            right={
              <Pill label={'● ON'} />
            }
          />
          )}
          {devMode && uploadStatus && (
            <Row
              icon={<Text style={styles.rowEmoji}>{uploadStatus.consecutiveFailures > 0 ? '⚠️' : '☁️'}</Text>}
              title={
                uploadStatus.consecutiveFailures > 0
                  ? 'Upload not syncing'
                  : 'Upload sync'
              }
              subtitle={
                uploadStatus.consecutiveFailures > 0
                  ? `${uploadStatus.consecutiveFailures} failed attempts in a row · last ok ${relativeTime(uploadStatus.lastSuccessTs)} · ${uploadStatus.pending} queued`
                  : `Last synced ${relativeTime(uploadStatus.lastSuccessTs)} · ${uploadStatus.pending} queued`
              }
              right={
                uploadStatus.consecutiveFailures > 0 ? (
                  <Pill label="SYNC ISSUE" color={colors.amber} bg={colors.amberSoft} />
                ) : undefined
              }
              style={styles.rowDivider}
            />
          )}
          {devMode && consent.health && !healthWorking && (
            <Row
              icon={<Text style={styles.rowEmoji}>{'\u2665\uFE0F'}</Text>}
              iconBg={colors.roseSoft}
              title="No health data"
              subtitle={`${HEALTH_STATE_TEXT[healthStatus.state]}${
                healthStatus.lastPollTs
                  ? ` · checked ${relativeTime(healthStatus.lastPollTs)}`
                  : ''
              }`}
              right={<Pill label="NO DATA" />}
              style={styles.rowDivider}
            />
          )}
          {devMode && showWearableHint && (
            <Row
              icon={<Text style={styles.rowEmoji}>{'⌚'}</Text>}
              title="No heart-rate or sleep data yet"
              style={styles.rowDivider}
            />
          )}
          <Row
            icon={<Text style={styles.rowEmoji}>{'\u{1F6E0}\u{FE0F}'}</Text>}
            iconBg={colors.amberSoft}
            title="Developer mode"
            style={devMode ? styles.rowDivider : undefined}
            right={
              <Switch
                value={devMode}
                onValueChange={(v) => void setDevMode(v)}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor={colors.surface}
              />
            }
          />
          {__DEV__ && devMode && (
            <Row
              icon={<Text style={styles.rowEmoji}>{'\u{1F4F8}'}</Text>}
              iconBg={colors.amberSoft}
              title="Screenshot mode"
              subtitle="A month of demo data, no sample labels"
              right={
                <Switch
                  value={screenshotMode}
                  onValueChange={(v) => void setScreenshotMode(v)}
                  trackColor={{ false: colors.line, true: colors.primary }}
                  thumbColor={colors.surface}
                />
              }
            />
          )}
        </Card>


        {CONFIG.USE_FIREBASE && hasRealSession() && (
          <Pressable
            onPress={handleManageData}
            hitSlop={8}
            accessibilityRole="button"
            style={styles.deleteLink}
          >
            <Text style={styles.deleteLinkText}>Delete account or data</Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  subtitle: {
    ...type.body,
    color: colors.ink2,
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  rowCard: {
    marginTop: spacing.xl,
    paddingVertical: spacing.xs,
  },
  togglesCard: {
    marginTop: spacing.xl,
    paddingVertical: spacing.xs,
  },
  sectionTitle: {
    ...type.h2,
    color: colors.ink,
    marginTop: spacing.xl,
  },
  rowEmoji: {
    fontSize: 18,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  deleteLink: {
    alignSelf: 'center',
    marginTop: spacing.xl,
    padding: spacing.sm,
  },
  deleteLinkText: {
    ...type.caption,
    color: colors.ink3,
  },
});
