/**
 * JS face of the local native module in `./ios`. Safe to call on any platform: without
 * the module or the Family Controls entitlement, each function returns `null`, `[]` or
 * `'unavailable'` instead of throwing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface NativeIosUsageModule {
  screenTimeConfigured: boolean;

  setCallSensingEnabled(enabled: boolean): Promise<boolean>;
  setScreenSensingEnabled(enabled: boolean): Promise<boolean>;
  drainScreenEvents(): Promise<RawScreenEvent[]>;
  callKeepAliveStatus(): Promise<CallKeepAliveStatus>;
  requestCallKeepAlive(): Promise<CallKeepAliveStatus>;
  drainCallSessions(): Promise<RawCallSession[]>;
  drainCallCoverage(): Promise<RawCoverageSpan[]>;

  screenTimeAuthorizationStatus(): Promise<ScreenTimeAuthorizationStatus>;
  requestScreenTimeAuthorization(): Promise<ScreenTimeAuthorizationStatus>;
  presentActivityPicker(category: UsageCategory): Promise<PickerResult>;
  selectionSummary(): Promise<SelectionSummary>;
  presentAppLabeler(): Promise<AppLabelResult>;
  appLabels(): Promise<Record<string, string>>;
  trackedAppIds(): Promise<string[]>;
  startUsageMonitoring(
    thresholdsByCategory: Record<string, number[]>,
    appThresholds: number[],
    probeMinutes: number
  ): Promise<string[]>;
  usageDiagnostics(): Promise<UsageDiagnostics>;
  stopUsageMonitoring(clearSelections: boolean): Promise<boolean>;
  monitoredThresholds(): Promise<string[]>;
  drainUsageThresholdEvents(): Promise<RawThresholdEvent[]>;
}

const native = requireOptionalNativeModule<NativeIosUsageModule>('MoodSenseIosUsage');

/**
 * `total` is whole-device screen time. Apple gives no way to read it as a number, so it
 * is a picker bucket that reports through the same threshold mechanism and is a lower
 * bound, never an exact total.
 */
export type UsageCategory = 'social' | 'audioVideo' | 'total';

/**
 * `unavailable` means the build cannot ask at all (no entitlement, or not iOS). That is
 * not something the participant did, so never show it as a refused permission.
 */
export type ScreenTimeAuthorizationStatus =
  | 'unavailable'
  | 'notDetermined'
  | 'denied'
  | 'approved';

export interface RawCallSession {
  startTs: number;
  endTs: number;
  durationMs: number;
  outgoing: boolean;
  partial?: boolean;
}

/**
 * A device lock or unlock as data protection reports it. There is no `screen_on`: waking the phone
 * without unlocking it never engages data protection, so it cannot be seen at all on iOS.
 */
export interface RawScreenEvent {
  type: 'screen_unlock' | 'screen_lock';
  ts: number;
}

export interface RawCoverageSpan {
  startTs: number;
  endTs: number;
  open: boolean;
}

/**
 * Location permission as it bears on call sensing: only `always` keeps MoodSense running, and relaunches it,
 * around the clock. `unavailable` means a build without the location background mode.
 */
export type CallKeepAliveStatus = 'unavailable' | 'notDetermined' | 'denied' | 'whenInUse' | 'always';

export interface RawThresholdEvent {
  name: string;
  ts: number;
}

export interface SelectionCount {
  applications: number;
  categories: number;
}

export type SelectionSummary = Record<UsageCategory, SelectionCount>;

export type PickerResult = SelectionSummary & { cancelled: boolean; reason?: string };

/**
 * `labels` maps the anonymous per-app id to the name the participant typed. iOS renders an app's real
 * icon and title but never hands the string to the app, so a name exists only because someone chose
 * to write it down — it is participant-reported data, not a system lookup.
 */
export interface AppLabelResult {
  cancelled: boolean;
  reason?: string;
  labels: Record<string, string>;
}

export interface UsageDiagnostics {
  appGroupConfigured: boolean;
  authorization: ScreenTimeAuthorizationStatus;
  selections: SelectionSummary;
  anySelection: boolean;
  monitoredEventCount: number;
  monitoredEventNames: string[];
  /** iOS's own view, not ours: a plan can be remembered locally while iOS has stopped monitoring it. */
  activityRegistered: boolean;
  pendingThresholdEvents: number;
  maxTrackedApps: number;
  eventBudget: number;
  callSensingEnabled: boolean;
  callKeepAlive: CallKeepAliveStatus;
  screenSensingEnabled: boolean;
  unlockObserver: UnlockObserverDiagnostics;
}

/**
 * Why a day can honestly show zero pick-ups. `armedAtMs` of 0 means the observer was never armed;
 * armed long ago with `observedCount` 0 means the device has no passcode, so data protection never
 * engages and no lock or unlock can ever be seen — the one case that must not read as "never used".
 */
export interface UnlockObserverDiagnostics {
  armedAtMs: number;
  observedCount: number;
  pendingEvents: number;
  protectedDataAvailable: boolean;
  /** iOS evicts the protection keys a beat after the screen locks, so a lock timestamp runs this late. */
  lockLagMs: number;
}

const EMPTY_SUMMARY: SelectionSummary = {
  social: { applications: 0, categories: 0 },
  audioVideo: { applications: 0, categories: 0 },
  total: { applications: 0, categories: 0 },
};

export const isAvailable: boolean = native != null;

export const isScreenTimeConfigured: boolean = native?.screenTimeConfigured === true;

/**
 * Persisted natively, so call sensing resumes on every launch without JS. Turning it off also drops calls and
 * coverage recorded but not yet drained, since that is consent being withdrawn.
 */
export async function setCallSensingEnabled(enabled: boolean): Promise<void> {
  await native?.setCallSensingEnabled(enabled);
}

/**
 * Lock/unlock sensing, persisted natively like call sensing and sharing the same keep-alive, so
 * turning either one on is enough to keep MoodSense running in the background.
 */
export async function setScreenSensingEnabled(enabled: boolean): Promise<void> {
  await native?.setScreenSensingEnabled(enabled);
}

export async function drainScreenEvents(): Promise<RawScreenEvent[]> {
  if (!native) return [];
  const events = await native.drainScreenEvents();
  return Array.isArray(events) ? events : [];
}

export async function callKeepAliveStatus(): Promise<CallKeepAliveStatus> {
  if (!native) return 'unavailable';
  return native.callKeepAliveStatus();
}

export async function requestCallKeepAlive(): Promise<CallKeepAliveStatus> {
  if (!native) return 'unavailable';
  return native.requestCallKeepAlive();
}

export async function drainCallSessions(): Promise<RawCallSession[]> {
  if (!native) return [];
  const sessions = await native.drainCallSessions();
  return Array.isArray(sessions) ? sessions : [];
}

export async function drainCallCoverage(): Promise<RawCoverageSpan[]> {
  if (!native) return [];
  const spans = await native.drainCallCoverage();
  return Array.isArray(spans) ? spans : [];
}

export async function screenTimeAuthorizationStatus(): Promise<ScreenTimeAuthorizationStatus> {
  if (!native) return 'unavailable';
  return native.screenTimeAuthorizationStatus();
}

export async function requestScreenTimeAuthorization(): Promise<ScreenTimeAuthorizationStatus> {
  if (!native) return 'unavailable';
  return native.requestScreenTimeAuthorization();
}

export async function presentActivityPicker(category: UsageCategory): Promise<PickerResult> {
  if (!native) return { ...EMPTY_SUMMARY, cancelled: true, reason: 'unavailable' };
  return native.presentActivityPicker(category);
}

export async function selectionSummary(): Promise<SelectionSummary> {
  if (!native) return EMPTY_SUMMARY;
  return native.selectionSummary();
}

export async function presentAppLabeler(): Promise<AppLabelResult> {
  if (!native) return { cancelled: true, reason: 'unavailable', labels: {} };
  return native.presentAppLabeler();
}

export async function appLabels(): Promise<Record<string, string>> {
  if (!native) return {};
  const labels = await native.appLabels();
  return labels && typeof labels === 'object' ? labels : {};
}

export async function trackedAppIds(): Promise<string[]> {
  if (!native) return [];
  const ids = await native.trackedAppIds();
  return Array.isArray(ids) ? ids : [];
}

export async function startUsageMonitoring(
  thresholdsByCategory: Record<UsageCategory, readonly number[]>,
  appThresholds: readonly number[],
  probeMinutes = 0
): Promise<string[]> {
  if (!native) return [];
  // Per bucket rather than one shared ladder, since whole-device time runs far longer than any one group.
  const plain: Record<string, number[]> = {};
  for (const [category, minutes] of Object.entries(thresholdsByCategory)) {
    plain[category] = [...minutes];
  }
  return native.startUsageMonitoring(plain, [...appThresholds], probeMinutes);
}

/**
 * Why nothing is arriving. Every step of the Screen Time chain fails soft, so this is the only way to
 * tell "no entitlement" from "nothing picked" from "monitoring live but not crossed yet".
 */
export async function usageDiagnostics(): Promise<UsageDiagnostics | null> {
  if (!native) return null;
  return native.usageDiagnostics();
}

export async function stopUsageMonitoring(clearSelections = false): Promise<void> {
  await native?.stopUsageMonitoring(clearSelections);
}

export async function monitoredThresholds(): Promise<string[]> {
  if (!native) return [];
  return native.monitoredThresholds();
}

export async function drainUsageThresholdEvents(): Promise<RawThresholdEvent[]> {
  if (!native) return [];
  const events = await native.drainUsageThresholdEvents();
  return Array.isArray(events) ? events : [];
}
