package app.openrv.gatewaymonitor

import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

/** Starts and stops MonitorService, the foreground service behind live monitoring. */
class GatewayMonitorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GatewayMonitor")

    AsyncFunction("start") { title: String, text: String, offUrl: String? ->
      val context = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "The app isn't ready", null)
      val intent = Intent(context, MonitorService::class.java)
        .putExtra(MonitorService.EXTRA_TITLE, title)
        .putExtra(MonitorService.EXTRA_TEXT, text)
        .putExtra(MonitorService.EXTRA_OFF_URL, offUrl)
      try {
        // Starting again only updates the notification's text.
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        // Android refuses to start one from the background (ForegroundServiceStartNotAllowedException).
        throw CodedException("NOT_ALLOWED", e.message ?: "Android didn't allow live monitoring to start", e)
      }
    }

    AsyncFunction("stop") {
      appContext.reactContext?.let { it.stopService(Intent(it, MonitorService::class.java)) }
      Unit
    }

    Function("isRunning") { MonitorService.running }

    // A timer for the app's JavaScript in the background, where React Native pauses its own
    // timers (setTimeout) while the foreground service keeps the app running.
    AsyncFunction("wait") { ms: Int, promise: Promise ->
      Handler(Looper.getMainLooper()).postDelayed({ promise.resolve(null) }, ms.toLong())
    }
  }
}
