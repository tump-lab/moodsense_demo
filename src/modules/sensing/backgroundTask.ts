/**
 * Periodic background sensing sync (BGTaskScheduler on iOS, WorkManager on Android): the OS wakes the app roughly hourly to run the same one-shot polls as the foreground, then flush the upload queue.
 * Only collectors that work from a cold start belong here. Live sensor listeners don't: iOS gets motion back from CoreMotion's history, and on Android the sensing service records it and this task drains the service's queue.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useConsentStore } from '../consent/store';
import {
  pollAppUsageOnce,
  pollHealthOnce,
  pollIosUsageOnce,
  pollMotionHistoryOnce,
  pollSleepEstimateOnce,
  pollSleepOnce,
  pollStepsOnce,
  pollUsageEventsOnce,
} from './collectors';
import { flush } from './uploader';

// Still named 'health' from when this task only ran the health polls: the OS keys scheduled work by this string, so renaming it would orphan every existing registration.
export const SENSING_SYNC_TASK = 'moodsense-health-sync';

// Minimum minutes between runs; the OS usually delivers far less often.
const MINIMUM_INTERVAL_MINUTES = 60;

TaskManager.defineTask(SENSING_SYNC_TASK, async () => {
  try {
    // A cold background wake can run before SensingProvider has loaded consent, and the pre-load defaults would
    // read health/sleep as granted. load() is one SQLite query, so awaiting it every run is cheap.
    await useConsentStore.getState().load();

    // Each poller re-checks its own consent flag, so running all of them here is safe.
    // Sequential rather than Promise.all: they share one SQLite connection, and the raw readers must run before the sleep estimate that reads their rows and the flush that ships them.
    await pollHealthOnce({ allowBackground: true });
    await pollSleepOnce();
    await pollStepsOnce();
    await pollMotionHistoryOnce();
    await pollUsageEventsOnce();
    await pollAppUsageOnce();
    await pollIosUsageOnce();
    await pollSleepEstimateOnce();
    await flush();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.warn('Background sensing sync failed:', err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Idempotent register/unregister, called by SensingProvider whenever any sensing consent changes.
 * Failures are logged and swallowed: registration throws where background tasks aren't available (Expo Go, simulators, web), and sensing must keep working foreground-only there.
 */
export async function syncSensingBackgroundTask(enabled: boolean): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(SENSING_SYNC_TASK);
    if (enabled && !registered) {
      await BackgroundTask.registerTaskAsync(SENSING_SYNC_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES,
      });
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(SENSING_SYNC_TASK);
    }
  } catch (err) {
    console.warn('Background sensing sync (un)registration failed:', err);
  }
}
