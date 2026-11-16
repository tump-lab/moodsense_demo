package expo.modules.moodsensebackgroundsensing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Wakes the running service for its next burst. */
class BurstAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val service = SensingService.instance
    if (service != null) {
      service.requestBurst()
    } else {
      SensingService.startIfEnabled(context)
    }
  }
}

/** Restarts the service after a reboot or an app update, both of which stop it with no JS around to restart it. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
      intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
    ) {
      return
    }
    SensingService.startIfEnabled(context)
  }
}
