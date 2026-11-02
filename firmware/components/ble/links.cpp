// Outbound GATT connections to connected devices (NimBLE central). The gateway core decides when
// to connect and what to say (components/gateway/sessions.cpp); this file only moves bytes.
#include <algorithm>
#include <mutex>
#include <vector>

#include "esp_log.h"
#include "host/ble_hs.h"

#include "ble_internal.h"
#include "openrv/gateway.h"

namespace openrv::ble {

namespace {

const char *const TAG = "links";
constexpr int32_t CONNECT_TIMEOUT_MS = 10000;
constexpr size_t MAX_ADDR_TYPES = 64;

struct Slot {
  enum class State : uint8_t { FREE, CONNECTING, DISCOVERING, OPEN } state = State::FREE;
  uint16_t conn = NO_CONN;
  LinkSpec spec{};
  uint16_t svc_start = 0, svc_end = 0;
  uint16_t write_handle = 0, notify_handle = 0;
  uint16_t notify_end = 0;  // last handle of the notify characteristic (its descriptors are up to here)
  uint16_t cccd_handle = 0;
  bool write_no_rsp = false;
};

// Never call into the gateway while holding this: the gateway calls back in under its own lock.
std::recursive_mutex g_mutex;
Slot g_slots[MAX_LINKS];
/// Address type (public/random) last seen in each device's adverts; connecting needs it.
std::vector<std::pair<Mac, uint8_t>> g_addr_types;

intptr_t slot_arg(int slot) { return static_cast<intptr_t>(slot); }
int arg_slot(void *arg) { return static_cast<int>(reinterpret_cast<intptr_t>(arg)); }

bool uuid16_is(const ble_uuid_t *u, uint16_t value) {
  ble_uuid16_t want = BLE_UUID16_INIT(value);
  return ble_uuid_cmp(u, &want.u) == 0;
}

void drop(int slot) {
  uint16_t conn;
  {
    std::lock_guard lock(g_mutex);
    conn = g_slots[slot].conn;
  }
  if (conn != NO_CONN)
    ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);  // -> DISCONNECT -> on_link_closed
}

int on_cccd(uint16_t, const ble_gatt_error *error, ble_gatt_attr *, void *arg) {
  int slot = arg_slot(arg);
  if (error->status != 0) {
    ESP_LOGW(TAG, "slot %d: enabling notifications failed (%d)", slot, error->status);
    drop(slot);
    return 0;
  }
  {
    std::lock_guard lock(g_mutex);
    g_slots[slot].state = Slot::State::OPEN;
  }
  detail::g_gateway->on_link_open(slot);
  return 0;
}

int on_dsc(uint16_t conn, const ble_gatt_error *error, uint16_t, const ble_gatt_dsc *dsc, void *arg) {
  int slot = arg_slot(arg);
  std::unique_lock lock(g_mutex);
  Slot &s = g_slots[slot];
  if (error->status == 0 && dsc) {
    if (uuid16_is(&dsc->uuid.u, BLE_GATT_DSC_CLT_CFG_UUID16))
      s.cccd_handle = dsc->handle;
    return 0;
  }
  uint16_t cccd = s.cccd_handle;
  lock.unlock();
  static const uint8_t ENABLE[] = {0x01, 0x00};
  if (error->status != BLE_HS_EDONE || !cccd || ble_gattc_write_flat(conn, cccd, ENABLE, sizeof ENABLE, on_cccd, arg) != 0) {
    ESP_LOGW(TAG, "slot %d: notifications can't be enabled", slot);
    drop(slot);
  }
  return 0;
}

int on_chr(uint16_t conn, const ble_gatt_error *error, const ble_gatt_chr *chr, void *arg) {
  int slot = arg_slot(arg);
  std::unique_lock lock(g_mutex);
  Slot &s = g_slots[slot];
  if (error->status == 0 && chr) {
    // A characteristic's descriptors run up to the next characteristic's declaration.
    if (s.notify_handle && !s.notify_end && chr->def_handle > s.notify_handle)
      s.notify_end = chr->def_handle - 1;
    if (uuid16_is(&chr->uuid.u, s.spec.write_chr)) {
      s.write_handle = chr->val_handle;
      s.write_no_rsp = !(chr->properties & BLE_GATT_CHR_PROP_WRITE);
    }
    if (uuid16_is(&chr->uuid.u, s.spec.notify_chr))
      s.notify_handle = chr->val_handle;
    return 0;
  }
  if (error->status != BLE_HS_EDONE || !s.write_handle || !s.notify_handle) {
    lock.unlock();
    ESP_LOGW(TAG, "slot %d: characteristics not found", slot);
    drop(slot);
    return 0;
  }
  uint16_t start = s.notify_handle + 1, end = s.notify_end ? s.notify_end : s.svc_end;
  lock.unlock();
  if (start > end || ble_gattc_disc_all_dscs(conn, start, end, on_dsc, arg) != 0) {
    ESP_LOGW(TAG, "slot %d: notify characteristic has no descriptors", slot);
    drop(slot);
  }
  return 0;
}

int on_svc(uint16_t conn, const ble_gatt_error *error, const ble_gatt_svc *svc, void *arg) {
  int slot = arg_slot(arg);
  std::unique_lock lock(g_mutex);
  Slot &s = g_slots[slot];
  if (error->status == 0 && svc) {
    s.svc_start = svc->start_handle;
    s.svc_end = svc->end_handle;
    return 0;
  }
  uint16_t start = s.svc_start, end = s.svc_end;
  lock.unlock();
  if (error->status != BLE_HS_EDONE || !start || ble_gattc_disc_all_chrs(conn, start, end, on_chr, arg) != 0) {
    ESP_LOGW(TAG, "slot %d: service not found", slot);
    drop(slot);
  }
  return 0;
}

int on_link_gap(ble_gap_event *event, void *arg) {
  int slot = arg_slot(arg);
  switch (event->type) {
    case BLE_GAP_EVENT_CONNECT: {
      detail::start_scan();  // connecting paused it
      if (event->connect.status != 0) {
        {
          std::lock_guard lock(g_mutex);
          g_slots[slot] = Slot{};
        }
        detail::g_gateway->on_link_closed(slot, true);
        return 0;
      }
      uint16_t conn = event->connect.conn_handle;
      ble_uuid16_t service;
      {
        std::lock_guard lock(g_mutex);
        g_slots[slot].conn = conn;
        g_slots[slot].state = Slot::State::DISCOVERING;
        service = BLE_UUID16_INIT(g_slots[slot].spec.service);
      }
      ble_gattc_exchange_mtu(conn, nullptr, nullptr);
      if (ble_gattc_disc_svc_by_uuid(conn, &service.u, on_svc, arg) != 0)
        drop(slot);
      return 0;
    }
    case BLE_GAP_EVENT_DISCONNECT: {
      bool was_open;
      {
        std::lock_guard lock(g_mutex);
        was_open = g_slots[slot].state == Slot::State::OPEN;
        g_slots[slot] = Slot{};
      }
      detail::g_gateway->on_link_closed(slot, !was_open);
      return 0;
    }
    case BLE_GAP_EVENT_NOTIFY_RX: {
      uint16_t notify;
      {
        std::lock_guard lock(g_mutex);
        notify = g_slots[slot].notify_handle;
      }
      if (event->notify_rx.attr_handle != notify)
        return 0;
      uint8_t buf[512];
      uint16_t len = 0;
      if (ble_hs_mbuf_to_flat(event->notify_rx.om, buf, sizeof buf, &len) == 0)
        detail::g_gateway->on_link_data(slot, {buf, len});
      return 0;
    }
    default:
      return 0;
  }
}

class NimbleLinks : public LinkIo {
 public:
  bool open(int slot, const LinkSpec &spec) override {
    ble_addr_t addr{};
    {
      std::lock_guard lock(g_mutex);
      bool busy = std::any_of(std::begin(g_slots), std::end(g_slots), [](const Slot &s) {
        return s.state == Slot::State::CONNECTING || s.state == Slot::State::DISCOVERING;
      });
      if (busy || g_slots[slot].state != Slot::State::FREE)
        return false;
      addr.type = BLE_ADDR_PUBLIC;
      for (auto &[mac, type] : g_addr_types)
        if (mac == spec.mac)
          addr.type = type;
      g_slots[slot] = Slot{};
      g_slots[slot].spec = spec;
      g_slots[slot].state = Slot::State::CONNECTING;
    }
    std::reverse_copy(spec.mac.begin(), spec.mac.end(), addr.val);
    if (ble_gap_disc_active())
      ble_gap_disc_cancel();  // NimBLE can't connect while scanning
    int rc = ble_gap_connect(detail::g_own_addr_type, &addr, CONNECT_TIMEOUT_MS, nullptr, on_link_gap,
                             reinterpret_cast<void *>(slot_arg(slot)));
    if (rc != 0) {
      ESP_LOGW(TAG, "slot %d: connect failed to start (%d)", slot, rc);
      {
        std::lock_guard lock(g_mutex);
        g_slots[slot] = Slot{};
      }
      detail::start_scan();
      return false;
    }
    return true;
  }

  bool write(int slot, Bytes data) override {
    uint16_t conn, handle;
    bool no_rsp;
    {
      std::lock_guard lock(g_mutex);
      const Slot &s = g_slots[slot];
      if (s.state != Slot::State::OPEN)
        return false;
      conn = s.conn;
      handle = s.write_handle;
      no_rsp = s.write_no_rsp;
    }
    int rc = no_rsp ? ble_gattc_write_no_rsp_flat(conn, handle, data.data(), data.size())
                    : ble_gattc_write_flat(conn, handle, data.data(), data.size(), nullptr, nullptr);
    return rc == 0;
  }

  void close(int slot) override {
    Slot::State state;
    {
      std::lock_guard lock(g_mutex);
      state = g_slots[slot].state;
    }
    if (state == Slot::State::CONNECTING)
      ble_gap_conn_cancel();  // -> CONNECT with an error status -> on_link_closed
    else if (state != Slot::State::FREE)
      drop(slot);
  }
};

}  // namespace

void detail::note_addr(const ble_addr_t &addr) {
  if (addr.type != BLE_ADDR_RANDOM)
    return;  // public is the default
  Mac mac;
  std::reverse_copy(addr.val, addr.val + 6, mac.begin());
  std::lock_guard lock(g_mutex);
  for (auto &[m, type] : g_addr_types)
    if (m == mac)
      return;
  if (g_addr_types.size() < MAX_ADDR_TYPES)
    g_addr_types.emplace_back(mac, addr.type);
}

LinkIo &links() {
  static NimbleLinks instance;
  return instance;
}

}  // namespace openrv::ble
