package app.openrv.gatewaypairing

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Pairs with the gateway from the phone's side. When the gateway asks to pair, Android asks the
 * person twice (allow the request, then confirm the pairing); when the app asks, once.
 */
class GatewayPairingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GatewayPairing")

    // Needs BLUETOOTH_CONNECT, which the app already has for talking to the gateway.
    @SuppressLint("MissingPermission")
    AsyncFunction("createBond") { address: String ->
      val device = device(address)
      // The app only asks when the gateway says this phone isn't paired, so a bond the phone still
      // has is stale (the gateway was reset or reflashed): forget it first, or nothing happens.
      if (device.bondState != BluetoothDevice.BOND_NONE && !removeBond(device)) return@AsyncFunction false
      device.createBond()
    }

    /** Forgets this phone's pairing with a device, if it has one; true when there's none left. */
    @SuppressLint("MissingPermission")
    AsyncFunction("forgetBond") { address: String ->
      val device = device(address)
      device.bondState == BluetoothDevice.BOND_NONE || removeBond(device)
    }

    @SuppressLint("MissingPermission")
    // Bonding counts too: with a stale pairing, Android re-pairs by itself as it connects, which
    // stalls until it times out.
    Function("isBonded") { address: String -> device(address).bondState != BluetoothDevice.BOND_NONE }
  }

  private fun device(address: String): BluetoothDevice {
    val context = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "The app isn't ready", null)
    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
      ?: throw CodedException("NO_BLUETOOTH", "This phone has no Bluetooth", null)
    return adapter.getRemoteDevice(address.uppercase())
  }

  /** Forgets a bond. Android has no public call for it, so this uses the hidden one apps rely on. */
  @SuppressLint("MissingPermission")
  private fun removeBond(device: BluetoothDevice): Boolean {
    fun hidden(name: String) = try {
      device.javaClass.getMethod(name).invoke(device) as Boolean
    } catch (e: Exception) {
      false
    }
    // A pairing in progress (Android retrying the old one) has to be stopped first.
    if (device.bondState == BluetoothDevice.BOND_BONDING) {
      hidden("cancelBondProcess")
      var waited = 0
      while (device.bondState == BluetoothDevice.BOND_BONDING && waited++ < 20) Thread.sleep(100)
    }
    if (device.bondState == BluetoothDevice.BOND_NONE) return true
    if (!hidden("removeBond")) return false
    // It's asynchronous; give it up to 3 seconds.
    var waited = 0
    while (device.bondState != BluetoothDevice.BOND_NONE && waited++ < 30) Thread.sleep(100)
    return device.bondState == BluetoothDevice.BOND_NONE
  }
}
