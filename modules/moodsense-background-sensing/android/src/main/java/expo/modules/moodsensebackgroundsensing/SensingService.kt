package expo.modules.moodsensebackgroundsensing

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.util.Calendar
import kotlin.math.roundToInt

/**
 * Keeps motion sensing going while MoodSense's UI is closed.
 *
 * Android 9+ stops delivering accelerometer and step events to background apps, and Doze
 * freezes timers, so none of this can happen in JS once the app leaves the screen. A
 * foreground service (with the ongoing notification Android requires for one) keeps the
 * sensors reachable, and an inexact allow-while-idle alarm wakes the CPU for each burst.
 * In deep Doze Android spaces those alarms out (roughly every 9-15 minutes), which is why
 * each hour records how many bursts actually ran.
 *
 * Everything goes to SensingStore; JS drains it and runs the classifier, so
 * activityInference.ts stays the one definition of an activity label.
 */
class SensingService : Service(), SensorEventListener {
  private lateinit var handlerThread: HandlerThread
  private lateinit var handler: Handler
  private lateinit var sensorManager: SensorManager
  private lateinit var store: SensingStore
  private var wakeLock: PowerManager.WakeLock? = null

  // Everything below is touched only on the handler thread.
  private var stepCounterRegistered = false
  private var lastStepValue: Float? = null
  private var burst: Burst? = null
  private var lastBurstStartedAt = 0L
  private var lastPruneAt = 0L
  private var burstsScheduled = false

  private class Burst(val startedAt: Long, val countsSteps: Boolean) {
    val samples = StringBuilder("[")
    var sampleCount = 0
    var steps = 0
  }

  override fun onCreate() {
    super.onCreate()
    handlerThread = HandlerThread("MoodSenseSensing").also { it.start() }
    handler = Handler(handlerThread.looper)
    sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    store = SensingStore.get(this)
    wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MoodSense:sensingBurst")
      .apply { setReferenceCounted(false) }
    instance = this
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForeground comes first even when about to stop: after startForegroundService(), skipping it crashes the app.
    if (!enterForeground()) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!SensingPrefs.isEnabled(this) || !hasActivityRecognition(this)) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    handler.post {
      registerStepCounter()
      if (!burstsScheduled) {
        burstsScheduled = true
        beginBurst()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    handler.removeCallbacksAndMessages(null)
    sensorManager.unregisterListener(this)
    if (!SensingPrefs.isEnabled(this)) cancelAlarm(this)
    handlerThread.quitSafely()
    releaseWakeLock()
    super.onDestroy()
  }

  /** From the alarm receiver, on the main thread. The wake lock is taken before returning because the alarm's own lock ends with onReceive. */
  internal fun requestBurst() {
    wakeLock?.acquire(SensingPrefs.burstMs(this) + WAKE_LOCK_SLACK_MS)
    handler.post { beginBurst() }
  }

  private fun beginBurst() {
    if (burst != null) return
    val now = System.currentTimeMillis()
    val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    // Alarms can arrive bunched up after Doze; at most one burst per half interval, the rest are dropped.
    if (accelerometer == null || now - lastBurstStartedAt < SensingPrefs.intervalMs(this) / 2) {
      scheduleNextBurst()
      releaseWakeLock()
      return
    }

    val burstMs = SensingPrefs.burstMs(this)
    wakeLock?.acquire(burstMs + WAKE_LOCK_SLACK_MS)
    val detector = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
    lastBurstStartedAt = now
    burst = Burst(now, detector != null)
    val samplingUs = (SensingPrefs.sampleIntervalMs(this) * 1000).toInt()
    sensorManager.registerListener(this, accelerometer, samplingUs, handler)
    // The detector, not the counter, for the in-burst count: the counter can lag by several seconds, longer than the burst.
    if (detector != null) {
      sensorManager.registerListener(this, detector, SensorManager.SENSOR_DELAY_FASTEST, handler)
    }
    handler.postDelayed({ finishBurst() }, burstMs)
  }

  private fun finishBurst() {
    val b = burst ?: return
    burst = null
    sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sensorManager.unregisterListener(this, it) }
    sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)?.let { sensorManager.unregisterListener(this, it) }

    b.samples.append(']')
    try {
      store.insertBurst(
        b.startedAt,
        System.currentTimeMillis() - b.startedAt,
        if (b.countsSteps) b.steps else null,
        b.samples.toString()
      )
      store.countBurst(localHourStart(b.startedAt))
      if (b.startedAt - lastPruneAt > PRUNE_EVERY_MS) {
        store.prune(b.startedAt - RETENTION_MS)
        lastPruneAt = b.startedAt
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not store a burst", e)
    }
    scheduleNextBurst()
    releaseWakeLock()
  }

  private fun registerStepCounter() {
    if (stepCounterRegistered) return
    val counter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return
    // Stays registered for the service's whole life: Android only promises the counter keeps counting through suspend while a listener is registered, and batching lets it do so with the CPU asleep.
    stepCounterRegistered = sensorManager.registerListener(
      this,
      counter,
      SensorManager.SENSOR_DELAY_NORMAL,
      STEP_BATCH_LATENCY_US,
      handler
    )
  }

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_ACCELEROMETER -> burst?.let { b ->
        if (b.sampleCount > 0) b.samples.append(',')
        // Divided by g to match expo-sensors, which the foreground path and activityInference.ts assume.
        b.samples.append('[')
          .append(inG(event.values[0])).append(',')
          .append(inG(event.values[1])).append(',')
          .append(inG(event.values[2])).append(']')
        b.sampleCount += 1
      }
      Sensor.TYPE_STEP_DETECTOR -> burst?.let { b ->
        if (wallTimeOf(event) >= b.startedAt) b.steps += 1
      }
      Sensor.TYPE_STEP_COUNTER -> recordStepCounter(event)
    }
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}

  private fun recordStepCounter(event: SensorEvent) {
    val value = event.values[0]
    val previous = lastStepValue
    lastStepValue = value
    // The first reading after a (re)start only sets the baseline: steps taken while the service was down can't be placed in time, so they are left out rather than piled into this hour.
    if (previous == null || value < previous) return
    val delta = (value - previous).roundToInt()
    if (delta <= 0) return
    try {
      store.addSteps(localHourStart(wallTimeOf(event)), delta)
    } catch (e: Exception) {
      Log.w(TAG, "Could not store steps", e)
    }
  }

  private fun scheduleNextBurst() {
    getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
      AlarmManager.ELAPSED_REALTIME_WAKEUP,
      SystemClock.elapsedRealtime() + SensingPrefs.intervalMs(this),
      alarmIntent(this)
    )
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  private fun enterForeground(): Boolean = try {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    true
  } catch (e: Exception) {
    Log.w(TAG, "Could not enter the foreground", e)
    false
  }

  private fun buildNotification(): Notification {
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Motion sensing", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while MoodSense records motion and steps."
        setShowBadge(false)
      }
    )
    val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("MoodSense is recording motion")
      .setContentText("Steps and movement, even while the app is closed.")
      .setStyle(
        Notification.BigTextStyle().bigText(
          "Steps and movement, even while the app is closed. " +
            "Withdraw motion consent in MoodSense to stop it."
        )
      )
      .setOngoing(true)
      .setContentIntent(contentIntent)
      .build()
  }

  private fun inG(value: Float): Double =
    Math.round(value / SensorManager.GRAVITY_EARTH * 10_000.0) / 10_000.0

  /** Sensor timestamps are elapsed-realtime nanos of the measurement, which for batched events can be minutes before delivery. */
  private fun wallTimeOf(event: SensorEvent): Long {
    val ageMs = (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000
    return System.currentTimeMillis() - ageMs.coerceAtLeast(0)
  }

  private fun localHourStart(wallMs: Long): Long = Calendar.getInstance().run {
    timeInMillis = wallMs
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
    timeInMillis
  }

  companion object {
    private const val TAG = "MoodSenseSensing"
    private const val CHANNEL_ID = "moodsense_sensing"
    private const val NOTIFICATION_ID = 7301
    private const val STEP_BATCH_LATENCY_US = 5 * 60 * 1_000_000
    private const val WAKE_LOCK_SLACK_MS = 10_000L
    private const val RETENTION_MS = 8L * 24 * 60 * 60 * 1000
    private const val PRUNE_EVERY_MS = 6L * 60 * 60 * 1000

    @Volatile
    internal var instance: SensingService? = null

    /** ACTIVITY_RECOGNITION only became a runtime permission in Android 10; before that it is granted at install. */
    fun hasActivityRecognition(context: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) ==
        PackageManager.PERMISSION_GRANTED

    /** Null when the start was requested, otherwise why it wasn't. */
    fun startIfEnabled(context: Context): String? {
      if (!SensingPrefs.isEnabled(context)) return "disabled"
      if (!hasActivityRecognition(context)) return "permission_denied"
      return try {
        context.startForegroundService(Intent(context, SensingService::class.java))
        null
      } catch (e: Exception) {
        // Android 12+ refuses most starts from the background; START_STICKY, the boot receiver and the next app launch are the recovery paths.
        "start_failed: ${e.javaClass.simpleName}"
      }
    }

    fun cancelAlarm(context: Context) {
      context.getSystemService(AlarmManager::class.java).cancel(alarmIntent(context))
    }

    private fun alarmIntent(context: Context): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, BurstAlarmReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
  }
}
