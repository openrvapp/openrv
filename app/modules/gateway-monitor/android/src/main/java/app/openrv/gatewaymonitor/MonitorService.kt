package app.openrv.gatewaymonitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * A foreground service with nothing to do itself: while it runs, Android keeps the app's process,
 * and so its JavaScript and its Bluetooth connection to the gateway, alive in the background. The
 * app's code does the watching. It isn't sticky: if Android stops the app anyway, the service
 * doesn't come back without it, so its notification never claims monitoring that isn't happening.
 */
class MonitorService : Service() {
  /** The app link the notification's "Turn off" button opens. */
  private var offUrl: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "OpenRV"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Watching for alerts"
    offUrl = intent?.getStringExtra(EXTRA_OFF_URL) ?: offUrl
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification(title, text),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
    )
    running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun notification(title: String, text: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Live monitoring", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shown while the app watches the gateway for alerts"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(open)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    // "Turn off" opens the app's monitoring setting, so the person chooses there.
    offUrl?.let { url ->
      val turnOff = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val pending = PendingIntent.getActivity(this, 1, turnOff, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      builder.addAction(0, "Turn off", pending)
    }
    return builder.build()
  }

  /** The app's notification icon (from expo-notifications' config), else its launcher icon. */
  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  companion object {
    const val CHANNEL_ID = "monitoring"
    const val NOTIFICATION_ID = 7301
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_OFF_URL = "offUrl"

    @Volatile
    var running = false
      private set
  }
}
