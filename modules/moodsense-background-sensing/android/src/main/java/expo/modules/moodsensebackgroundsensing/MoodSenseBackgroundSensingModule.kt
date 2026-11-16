package expo.modules.moodsensebackgroundsensing

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridge for the Android sensing service. JS decides when it runs (motion consent);
 * the service and SensingStore do the rest without JS.
 */
class MoodSenseBackgroundSensingModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MoodSenseBackgroundSensing")

    /** Records consent in prefs before starting, so a later reboot restarts the service even if this start is refused. */
    AsyncFunction("startService") { intervalMs: Double, burstMs: Double, sampleIntervalMs: Double ->
      SensingPrefs.enable(context, intervalMs.toLong(), burstMs.toLong(), sampleIntervalMs.toLong())
      SensingService.startIfEnabled(context) ?: "started"
    }

    AsyncFunction("stopService") { discardPending: Boolean ->
      SensingPrefs.disable(context)
      context.stopService(Intent(context, SensingService::class.java))
      SensingService.cancelAlarm(context)
      if (discardPending) SensingStore.get(context).clear()
      true
    }

    AsyncFunction("serviceStatus") {
      mapOf(
        "enabled" to SensingPrefs.isEnabled(context),
        "running" to (SensingService.instance != null),
        "activityRecognitionGranted" to SensingService.hasActivityRecognition(context),
      )
    }

    AsyncFunction("readBursts") { limit: Int ->
      SensingStore.get(context).readBursts(limit)
    }

    AsyncFunction("ackBursts") { throughId: Double ->
      SensingStore.get(context).deleteBurstsThrough(throughId.toLong())
      true
    }

    AsyncFunction("readStepHours") { sinceMs: Double ->
      SensingStore.get(context).readStepHours(sinceMs.toLong())
    }
  }
}
