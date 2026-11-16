/**
 * Starts the collectors the user has consented to and stops them when consent is revoked; effects re-run whenever a consent flag flips.
 * Mounted once at the app root (App.tsx) so sensing runs for the whole session.
 */
import React, { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { CONFIG } from '../../config';
import { getActiveUid, subscribeActiveUid } from '../../services/firebase';
import { flush as flushLogging } from '../../services/logging';
import { useConsentStore } from '../consent/store';
import { useDevModeStore } from '../settings/devMode';
import { useLlmSettingsStore } from '../settings/llmSettings';
import {
  startAccelerometer,
  startActivityRecognition,
  startBackgroundMotion,
  startPedometer,
  startScreenProxy,
  startHealthData,
  startSleepDetection,
  startSleepEstimate,
  startAppUsageTracking,
  startUsageEventPolling,
  startIosUsage,
  primeSensingPermissions,
} from './collectors';
import { syncSensingBackgroundTask } from './backgroundTask';
import { flush as flushSensing } from './uploader';

/**
 * Which account the permission sheets have already been offered to in this process. Module scope
 * rather than a ref: it must survive this hook remounting, but not the app being relaunched.
 */
let primedForUid: string | null = null;

/**
 * Whether a sign-in has asked for the sheets to go up. Off by default, because the effect below
 * runs on consent hydrating, and consent hydrates whenever a screen asks for it — opening Settings
 * was enough to put three permission sheets in front of someone who had only gone there to look at
 * what the app collects. Arming it from the sign-in path instead ties the asks to the one moment
 * they belong to.
 */
let primeArmed = false;

/**
 * Which account the per-account stores currently hold. Module scope, like `primedForUid`: it has to
 * survive this hook remounting but not the app being relaunched.
 */
let hydratedForUid: string | null = null;

/** Called from the sign-in path: the next consent hydration may offer the permission sheets. */
export function armSensingPermissionPrime(): void {
  primeArmed = true;
}

export function useSensingLifecycle(): void {
  const loaded = useConsentStore((s) => s.loaded);
  const agreed = useConsentStore((s) => s.agreed);
  const llmLoaded = useLlmSettingsStore((s) => s.loaded);
  const devModeLoaded = useDevModeStore((s) => s.loaded);
  const devMode = useDevModeStore((s) => s.enabled);
  const motion = useConsentStore((s) => s.motion);
  const screen = useConsentStore((s) => s.screen);
  const health = useConsentStore((s) => s.health);
  const sleep = useConsentStore((s) => s.sleep);
  const appUsage = useConsentStore((s) => s.appUsage);
  const calls = useConsentStore((s) => s.calls);

  /**
   * The uid the stores below belong to, as Firebase reports it — `null` until it has reported at
   * all. Not `getActiveUid()`, which answers `'local'` during the first moments of every launch,
   * before the persisted session has finished restoring.
   */
  const [activeUid, setActiveUid] = useState<string | null>(null);
  useEffect(() => subscribeActiveUid(setActiveUid), []);

  /**
   * Hydrates consent and the AI opt-in, and re-hydrates them whenever the account changes.
   *
   * This used to be two `if (!loaded) load()` effects that ran on mount. On a returning launch
   * that is a race the stores lose: they read `'local'`'s rows, find none, and settle on "nothing
   * consented, AI off" — then mark themselves loaded, so nothing ever re-read them. Sensing did
   * not start, and the companion chat showed both "turn on AI" and "voice is off" banners for an
   * account whose switches were plainly on in Settings. Settings looked right only because its own
   * mount effect calls `load()` unconditionally, by then with the real uid.
   */
  useEffect(() => {
    if (activeUid == null) return;
    if (hydratedForUid !== activeUid) {
      hydratedForUid = activeUid;
      // Drop what the previous account — or the pre-restore `'local'` uid — left behind before
      // re-reading, so one account's flags are never on screen under another's name.
      useConsentStore.getState().reset();
      useLlmSettingsStore.getState().reset();
      void useConsentStore.getState().load();
      void useLlmSettingsStore.getState().load();
      return;
    }
    // Reset from somewhere else (a sign-out, a withdrawal): put it back.
    if (!loaded) void useConsentStore.getState().load();
    if (!llmLoaded) void useLlmSettingsStore.getState().load();
  }, [activeUid, loaded, llmLoaded]);

  // Ask for the OS permissions the consent flags cannot grant, once per sign-in.
  //
  // Signing in is the case this exists for: only sign-up passes through ConsentOnboarding, so
  // someone who reinstalled and signed back in — which on iOS clears every grant along with the
  // app — was never asked again by anything. It lives here rather than on the sign-in path itself
  // so that it waits for the consent flags to hydrate, and it is armed from there so that an
  // ordinary hydration, such as opening Settings, cannot set it off.
  //
  // Safe on every sign-in: iOS decides a permission once, so a request for one already granted or
  // already refused returns without showing anything. That also bounds what this can achieve — a
  // refusal cannot be re-asked from here, only changed in iOS Settings.
  useEffect(() => {
    if (!loaded || !agreed || !primeArmed) return;
    const uid = getActiveUid();
    if (primedForUid === uid) return;
    primedForUid = uid;
    primeArmed = false;
    void primeSensingPermissions();
  }, [loaded, agreed]);

  // Developer mode is device-scoped rather than per-account, so unlike the two stores above it is
  // read once and never re-read on sign-in/sign-out.
  useEffect(() => {
    if (!devModeLoaded) void useDevModeStore.getState().load();
  }, [devModeLoaded]);

  useEffect(() => {
    const runFlush = () => {
      void flushSensing();
      void flushLogging();
    };
    runFlush();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') runFlush();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') runFlush();
    }, CONFIG.UPLOAD_FLUSH_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!loaded || !motion) return;
    const stopAccelerometer = startAccelerometer();
    const stopPedometer = startPedometer();
    const stopActivity = startActivityRecognition();
    // Covers the hours the app is closed: CoreMotion history on iOS, the sensing service on Android. Its teardown leaves the service running unless motion consent is off.
    const stopBackgroundMotion = startBackgroundMotion();
    return () => {
      stopAccelerometer();
      stopPedometer();
      stopActivity();
      stopBackgroundMotion();
    };
  }, [loaded, motion]);

  useEffect(() => {
    if (!loaded || !screen) return;
    return startScreenProxy();
  }, [loaded, screen]);

  useEffect(() => {
    if (!loaded || !health) return;
    return startHealthData();
  }, [loaded, health]);

  useEffect(() => {
    if (!loaded || !sleep) return;
    return startSleepDetection();
  }, [loaded, sleep]);

  useEffect(() => {
    if (!loaded || !sleep || !screen) return;
    return startSleepEstimate();
  }, [loaded, sleep, screen]);

  // The background task must be registered while any passive-sensing consent is on, not just health/sleep.
  // `voice` is left out because it only records while the user talks to the companion, so a background wakeup has nothing to collect.
  useEffect(() => {
    if (!loaded) return;
    void syncSensingBackgroundTask(motion || screen || health || sleep || appUsage || calls);
  }, [loaded, motion, screen, health, sleep, appUsage, calls]);

  useEffect(() => {
    if (!loaded || !appUsage) return;
    return startAppUsageTracking();
  }, [loaded, appUsage]);

  // Android's event stream feeds three consents at once, so it starts while any one is on.
  // The collector re-checks each consent per event kind, so a user with only `screen` on gets screen events and no call rows.
  useEffect(() => {
    if (!loaded || (!screen && !appUsage && !calls)) return;
    return startUsageEventPolling();
  }, [loaded, screen, appUsage, calls]);

  // The iOS collector no-ops on Android or without the native module, so it is gated on consents rather than platform.
  // `screen` belongs in here: it is what arms UnlockObserver and drains the unlocks it queued, so
  // leaving it out meant a participant who consented to screen but not to calls or app usage got no
  // pick-ups at all — the collector that reads them was never started.
  // Developer mode is a dependency because it decides whether the fast probe threshold is part of the
  // monitoring plan, and iOS only re-reads the plan when we restart monitoring.
  useEffect(() => {
    if (!loaded || !devModeLoaded || (!appUsage && !calls && !screen)) return;
    return startIosUsage();
  }, [loaded, devModeLoaded, devMode, appUsage, calls, screen]);
}

export default function SensingProvider(): React.JSX.Element | null {
  useSensingLifecycle();
  return null;
}
