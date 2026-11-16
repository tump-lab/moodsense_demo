package expo.modules.moodsensebackgroundsensing

import android.content.Context

/**
 * What the service needs to restart itself after a reboot or an app update, when no JS is
 * running to tell it: whether motion consent is on, and the sampling cadence.
 */
internal object SensingPrefs {
  private const val NAME = "moodsense_background_sensing"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_INTERVAL_MS = "interval_ms"
  private const val KEY_BURST_MS = "burst_ms"
  private const val KEY_SAMPLE_INTERVAL_MS = "sample_interval_ms"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  // commit, not apply: the boot receiver may be the next thing to read this, in a new process.
  fun enable(context: Context, intervalMs: Long, burstMs: Long, sampleIntervalMs: Long) {
    prefs(context).edit()
      .putBoolean(KEY_ENABLED, true)
      .putLong(KEY_INTERVAL_MS, intervalMs)
      .putLong(KEY_BURST_MS, burstMs)
      .putLong(KEY_SAMPLE_INTERVAL_MS, sampleIntervalMs)
      .commit()
  }

  fun disable(context: Context) {
    prefs(context).edit().putBoolean(KEY_ENABLED, false).commit()
  }

  fun intervalMs(context: Context): Long = prefs(context).getLong(KEY_INTERVAL_MS, 300_000L)

  fun burstMs(context: Context): Long = prefs(context).getLong(KEY_BURST_MS, 6_000L)

  fun sampleIntervalMs(context: Context): Long = prefs(context).getLong(KEY_SAMPLE_INTERVAL_MS, 50L)
}
