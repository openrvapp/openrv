import ExpoModulesCore
import NetworkExtension

/// Joins the gateway's firmware-update Wi-Fi and uploads the image over it: the iOS side of what
/// android/.../GatewayWifiModule.kt does. iOS asks the user once ("Join the network?"); the
/// configuration is for this app only and is removed again when the upload is done. iOS sends
/// requests to the gateway's address over that network, since it has no internet.
///
/// Needs the Hotspot Configuration capability (entitlement com.apple.developer.networking.
/// HotspotConfiguration), set in app.json.
public class GatewayWifiModule: Module {
  private var joinedSsid: String?

  public func definition() -> ModuleDefinition {
    Name("GatewayWifi")

    AsyncFunction("join") { (ssid: String, password: String, timeoutMs: Int, promise: Promise) in
      let config = NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false)
      config.joinOnce = true  // forgotten when the app goes to the background
      NEHotspotConfigurationManager.shared.apply(config) { error in
        if let error = error as NSError?,
          !(error.domain == NEHotspotConfigurationErrorDomain
            && error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue)
        {
          let denied =
            error.domain == NEHotspotConfigurationErrorDomain
            && error.code == NEHotspotConfigurationError.userDenied.rawValue
          promise.reject(
            "ERR_WIFI_UNAVAILABLE",
            denied
              ? "The gateway's update Wi-Fi wasn't joined."
              : "Couldn't join the gateway's update Wi-Fi. Is the gateway nearby? (\(error.localizedDescription))"
          )
          return
        }
        self.joinedSsid = ssid
        // iOS reports success once it starts joining; give the link a moment to come up.
        self.waitForNetwork(deadline: Date().addingTimeInterval(Double(timeoutMs) / 1000), promise: promise)
      }
    }

    AsyncFunction("upload") { (url: String, token: String, fileUri: String, promise: Promise) in
      guard let target = URL(string: url), let file = URL(string: fileUri) else {
        promise.reject("ERR_BAD_ARGS", "Bad upload address or file")
        return
      }
      var request = URLRequest(url: target, timeoutInterval: 120)
      request.httpMethod = "POST"
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
      let config = URLSessionConfiguration.ephemeral
      config.waitsForConnectivity = false
      URLSession(configuration: config).uploadTask(with: request, fromFile: file) { _, response, error in
        if let error = error {
          promise.reject("ERR_UPLOAD", "Upload failed: \(error.localizedDescription)")
          return
        }
        promise.resolve((response as? HTTPURLResponse)?.statusCode ?? 0)
      }.resume()
    }

    AsyncFunction("release") { (promise: Promise) in
      if let ssid = self.joinedSsid {
        NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
      }
      self.joinedSsid = nil
      promise.resolve(nil)
    }
  }

  /// Resolves once the gateway's web server answers, or at the deadline (the upload then reports why).
  private func waitForNetwork(deadline: Date, promise: Promise) {
    guard let probe = URL(string: "http://192.168.4.1/") else {
      promise.resolve(nil)
      return
    }
    var request = URLRequest(url: probe, timeoutInterval: 2)
    request.httpMethod = "GET"
    URLSession(configuration: .ephemeral).dataTask(with: request) { _, response, _ in
      if response != nil || Date() > deadline {
        promise.resolve(nil)
      } else {
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
          self.waitForNetwork(deadline: deadline, promise: promise)
        }
      }
    }.resume()
  }
}
