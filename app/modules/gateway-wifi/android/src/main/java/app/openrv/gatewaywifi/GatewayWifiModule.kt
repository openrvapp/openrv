package app.openrv.gatewaywifi

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.wifi.WifiNetworkSpecifier
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.HttpURLConnection
import java.net.URL

/**
 * Joins the gateway's firmware-update Wi-Fi with a network request (Android 10+) and uploads over
 * that network only. Android asks the user once; the phone's normal Wi-Fi and other apps are not
 * affected, and nothing is bound process-wide.
 */
class GatewayWifiModule : Module() {
  private var callback: ConnectivityManager.NetworkCallback? = null
  private var network: Network? = null

  private val connectivity: ConnectivityManager
    get() = appContext.reactContext!!.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  override fun definition() = ModuleDefinition {
    Name("GatewayWifi")

    AsyncFunction("join") { ssid: String, password: String, timeoutMs: Int, promise: Promise ->
      release()
      val specifier = WifiNetworkSpecifier.Builder().setSsid(ssid).setWpa2Passphrase(password).build()
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .setNetworkSpecifier(specifier)
        .build()
      var settled = false
      val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) {
          network = n
          if (!settled) {
            settled = true
            promise.resolve(null)
          }
        }

        override fun onUnavailable() {
          if (!settled) {
            settled = true
            promise.reject(CodedException("ERR_WIFI_UNAVAILABLE", "Couldn't join the gateway's update Wi-Fi. Is the gateway nearby, and did you allow the connection?", null))
          }
        }

        override fun onLost(n: Network) {
          if (n == network) network = null
        }
      }
      callback = cb
      connectivity.requestNetwork(request, cb, timeoutMs)
    }

    AsyncFunction("upload") { url: String, token: String, fileUri: String ->
      val net = network ?: throw CodedException("ERR_WIFI_NOT_JOINED", "Not on the gateway's Wi-Fi", null)
      val uri = Uri.parse(fileUri)
      // Our own files are plain paths; anything else goes through the content resolver.
      val file = if (uri.scheme == null || uri.scheme == "file") java.io.File(uri.path ?: fileUri) else null
      if (file != null && !file.isFile)
        throw CodedException("ERR_NO_FILE", "Firmware file not found: ${file.path}", null)
      val resolver = appContext.reactContext!!.contentResolver
      val length = file?.length() ?: resolver.openFileDescriptor(uri, "r")!!.use { it.statSize }
      val conn = net.openConnection(URL(url)) as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 15_000
        conn.readTimeout = 60_000
        conn.setFixedLengthStreamingMode(length)
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Content-Type", "application/octet-stream")
        val input = file?.inputStream() ?: resolver.openInputStream(uri)!!
        input.use { conn.outputStream.use { out -> it.copyTo(out) } }
        conn.responseCode
      } finally {
        conn.disconnect()
      }
    }

    AsyncFunction("release") {
      release()
    }

    OnDestroy {
      release()
    }
  }

  private fun release() {
    callback?.let {
      try {
        connectivity.unregisterNetworkCallback(it)
      } catch (_: IllegalArgumentException) {
        // already released
      }
    }
    callback = null
    network = null
  }
}
