#include "openrv/ble.h"

#include <algorithm>
#include <deque>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "esp_log.h"
#include "esp_timer.h"
#include "host/ble_hs.h"
#include "host/ble_store.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#include "ble_internal.h"
#include "openrv/gateway.h"

extern "C" void ble_store_config_init(void);
extern "C" int ble_store_config_write(int obj_type, const union ble_store_value *val);

namespace openrv::ble {

Gateway *detail::g_gateway = nullptr;
uint8_t detail::g_own_addr_type;

namespace {

using detail::g_gateway;
using detail::g_own_addr_type;
using detail::start_scan;

const char *const TAG = "ble";
constexpr size_t MAX_LINE = 4096;

// 6f70656e-7276-4000-8000-00000000000N ("openrv"), little-endian as NimBLE wants it.
#define OPENRV_UUID(n) BLE_UUID128_INIT(n, 0, 0, 0, 0, 0, 0, 0x80, 0x00, 0x40, 0x76, 0x72, 0x6e, 0x65, 0x70, 0x6f)
const ble_uuid128_t SERVICE_UUID = OPENRV_UUID(0x01);
const ble_uuid128_t RX_UUID = OPENRV_UUID(0x02);
const ble_uuid128_t TX_UUID = OPENRV_UUID(0x03);

struct PhoneLink {
  uint16_t conn = NO_CONN;
  uint16_t mtu = 23;
  std::string rx;                // bytes of the line being received
  std::deque<std::string> tx;    // packets waiting to be notified
  // Pairing or encrypting: notifications wait until it's done. Sending data while the link starts
  // encrypting makes it fail with a MIC failure (the phone reports "incorrect PIN").
  bool securing = false;
};

uint16_t g_tx_handle;
// Guards g_phones. Recursive: NimBLE can report NOTIFY_TX from inside ble_gatts_notify_custom.
std::recursive_mutex g_mutex;
bool g_pumping = false;
PhoneLink g_phones[MAX_PHONES];
// Retries a stalled send: when the stack is out of buffers, NOTIFY_TX may already have fired
// (inside our own notify call), so nothing else would wake the queue up.
esp_timer_handle_t g_retry_timer;
constexpr uint64_t RETRY_US = 20 * 1000;

// Bonds written since they were last looked at: a phone that has just paired (rather than one
// coming back with a bond it already had) is only let in while pairing is open. Host task only.
std::set<std::string> g_new_bonds;
bool g_synced = false;
std::vector<std::string> g_keep_pending;  // a prune asked for before the host was up
bool g_prune_pending = false;

std::string addr_str(const ble_addr_t &a) {
  char s[18];
  snprintf(s, sizeof s, "%02X:%02X:%02X:%02X:%02X:%02X", a.val[5], a.val[4], a.val[3], a.val[2], a.val[1], a.val[0]);
  return s;
}

int store_write(int obj_type, const ble_store_value *val) {
  if (obj_type == BLE_STORE_OBJ_TYPE_PEER_SEC)
    g_new_bonds.insert(addr_str(val->sec.peer_addr));
  return ble_store_config_write(obj_type, val);
}

void do_prune(const std::vector<std::string> &keep) {
  ble_addr_t peers[MYNEWT_VAL(BLE_STORE_MAX_BONDS)];
  int n = 0;
  if (ble_store_util_bonded_peers(peers, &n, MYNEWT_VAL(BLE_STORE_MAX_BONDS)) != 0)
    return;
  for (int i = 0; i < n; i++)
    if (std::find(keep.begin(), keep.end(), addr_str(peers[i])) == keep.end()) {
      ESP_LOGI(TAG, "Forgetting bond %s", addr_str(peers[i]).c_str());
      ble_store_util_delete_peer(&peers[i]);
    }
}

void terminate_cb(void *arg) {
  ble_gap_terminate(static_cast<uint16_t>(reinterpret_cast<uintptr_t>(arg)), BLE_ERR_REM_USER_CONN_TERM);
}

/// Disconnects after a moment, so a last message (why) can still go out.
void drop_later(uint16_t conn) {
  esp_timer_handle_t t;
  const esp_timer_create_args_t args{.callback = terminate_cb, .arg = reinterpret_cast<void *>(uintptr_t{conn}),
                                     .dispatch_method = ESP_TIMER_TASK, .name = "ble_drop",
                                     .skip_unhandled_events = true};
  if (esp_timer_create(&args, &t) == ESP_OK)
    esp_timer_start_once(t, 400 * 1000);  // the handle leaks; this is rare
}

PhoneLink *phone(uint16_t conn);

void set_securing(uint16_t conn, bool on) {
  std::lock_guard<std::recursive_mutex> lock(g_mutex);
  if (PhoneLink *p = phone(conn))
    p->securing = on;
}

/// The link to a phone is encrypted: let the gateway decide whether it may stay.
void on_encrypted(uint16_t conn) {
  ble_gap_conn_desc desc;
  if (ble_gap_conn_find(conn, &desc) != 0)
    return;
  std::string addr = addr_str(desc.peer_id_addr);
  bool new_bond = g_new_bonds.erase(addr) > 0;
  if (!desc.sec_state.bonded) {
    ESP_LOGW(TAG, "Encrypted but not bonded (%u)", conn);
    return;
  }
  if (!g_gateway->on_phone_secured(conn, addr, new_bond)) {
    if (new_bond)
      ble_store_util_delete_peer(&desc.peer_id_addr);
    drop_later(conn);
  }
}

PhoneLink *phone(uint16_t conn) {
  for (auto &p : g_phones)
    if (p.conn == conn)
      return &p;
  return nullptr;
}

void start_advertising();

/// Notifies queued packets until the stack runs out of buffers; returns false when it stalled.
bool pump_locked(uint16_t conn) {
  PhoneLink *p = phone(conn);
  if (p && p->securing)
    return true;  // ENC_CHANGE pumps again
  while (p && !p->tx.empty()) {
    const std::string &pkt = p->tx.front();
    os_mbuf *om = ble_hs_mbuf_from_flat(pkt.data(), pkt.size());
    if (!om)
      return false;
    int rc = ble_gatts_notify_custom(conn, g_tx_handle, om);
    if (rc == BLE_HS_ENOMEM)
      return false;
    if (rc != 0) {
      ESP_LOGW(TAG, "notify failed on %u: %d", conn, rc);
      p->tx.clear();
      return true;
    }
    p->tx.pop_front();
  }
  return true;
}

void pump(uint16_t conn) {
  std::lock_guard<std::recursive_mutex> lock(g_mutex);
  if (g_pumping)
    return;  // a NOTIFY_TX raised by our own notify; the loop below carries on
  g_pumping = true;
  bool done = pump_locked(conn);
  g_pumping = false;
  if (!done && !esp_timer_is_active(g_retry_timer))
    esp_timer_start_once(g_retry_timer, RETRY_US);
}

void pump_all(void *) {
  std::lock_guard<std::recursive_mutex> lock(g_mutex);
  for (auto &p : g_phones)
    if (p.conn != NO_CONN)
      pump(p.conn);
}

int on_rx(uint16_t conn, uint16_t, ble_gatt_access_ctxt *ctxt, void *) {
  if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR)
    return BLE_ATT_ERR_UNLIKELY;
  uint8_t buf[512];
  uint16_t len = 0;
  if (ble_hs_mbuf_to_flat(ctxt->om, buf, sizeof buf, &len) != 0)
    return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;

  std::string line;
  for (uint16_t i = 0; i < len; i++) {
    {
      std::lock_guard<std::recursive_mutex> lock(g_mutex);
      PhoneLink *p = phone(conn);
      if (!p)
        return 0;
      if (buf[i] != '\n') {
        if (p->rx.size() < MAX_LINE)
          p->rx += static_cast<char>(buf[i]);
        continue;
      }
      line.swap(p->rx);
      p->rx.clear();
    }
    if (!line.empty())
      g_gateway->handle(conn, line);
  }
  return 0;
}

int on_tx(uint16_t, uint16_t, ble_gatt_access_ctxt *, void *) { return BLE_ATT_ERR_READ_NOT_PERMITTED; }

const ble_gatt_chr_def CHARACTERISTICS[] = {
    {.uuid = &RX_UUID.u, .access_cb = on_rx, .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP},
    {.uuid = &TX_UUID.u, .access_cb = on_tx, .flags = BLE_GATT_CHR_F_NOTIFY, .val_handle = &g_tx_handle},
    {},
};

const ble_gatt_svc_def SERVICES[] = {
    {.type = BLE_GATT_SVC_TYPE_PRIMARY, .uuid = &SERVICE_UUID.u, .characteristics = CHARACTERISTICS},
    {},
};

size_t phone_count() {
  std::lock_guard<std::recursive_mutex> lock(g_mutex);
  return std::count_if(std::begin(g_phones), std::end(g_phones), [](const PhoneLink &p) { return p.conn != NO_CONN; });
}

int on_gap(ble_gap_event *event, void *) {
  switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
      if (event->connect.status == 0) {
        {
          std::lock_guard<std::recursive_mutex> lock(g_mutex);
          if (PhoneLink *p = phone(NO_CONN)) {
            *p = PhoneLink{};
            p->conn = event->connect.conn_handle;
          }
        }
        g_gateway->on_phone_connect(event->connect.conn_handle);
        ESP_LOGI(TAG, "Phone connected (%u)", event->connect.conn_handle);
        // A phone that already has a bond gets an encrypted link straight away, no prompt.
        ble_gap_conn_desc desc;
        ble_store_key_sec key{};
        ble_store_value_sec sec;
        if (ble_gap_conn_find(event->connect.conn_handle, &desc) == 0) {
          key.peer_addr = desc.peer_id_addr;
          if (ble_store_read_peer_sec(&key, &sec) == 0 && ble_gap_security_initiate(event->connect.conn_handle) == 0)
            set_securing(event->connect.conn_handle, true);
        }
      }
      if (phone_count() < MAX_PHONES)
        start_advertising();
      return 0;
    case BLE_GAP_EVENT_DISCONNECT: {
      uint16_t conn = event->disconnect.conn.conn_handle;
      {
        std::lock_guard<std::recursive_mutex> lock(g_mutex);
        if (PhoneLink *p = phone(conn))
          *p = PhoneLink{};
      }
      g_gateway->on_phone_disconnect(conn);
      ESP_LOGI(TAG, "Phone disconnected (%u), reason %d", conn, event->disconnect.reason);
      start_advertising();
      return 0;
    }
    case BLE_GAP_EVENT_MTU: {
      std::lock_guard<std::recursive_mutex> lock(g_mutex);
      if (PhoneLink *p = phone(event->mtu.conn_handle))
        p->mtu = event->mtu.value;
      ESP_LOGI(TAG, "MTU %u on %u", event->mtu.value, event->mtu.conn_handle);
      return 0;
    }
    case BLE_GAP_EVENT_ENC_CHANGE:
      set_securing(event->enc_change.conn_handle, false);
      if (event->enc_change.status == 0)
        on_encrypted(event->enc_change.conn_handle);
      else
        ESP_LOGW(TAG, "Encryption failed on %u: %d", event->enc_change.conn_handle, event->enc_change.status);
      pump(event->enc_change.conn_handle);
      return 0;
    case BLE_GAP_EVENT_REPEAT_PAIRING: {
      // The phone lost its bond (forgot the gateway) and pairs again: start over, as a new phone,
      // which gets in only while pairing is open.
      ble_gap_conn_desc desc;
      if (ble_gap_conn_find(event->repeat_pairing.conn_handle, &desc) == 0)
        ble_store_util_delete_peer(&desc.peer_id_addr);
      return BLE_GAP_REPEAT_PAIRING_RETRY;
    }
    case BLE_GAP_EVENT_NOTIFY_TX:
      pump(event->notify_tx.conn_handle);
      return 0;
    case BLE_GAP_EVENT_ADV_COMPLETE:
      start_advertising();
      return 0;
    default:
      return 0;
  }
}

void start_advertising() {
  if (ble_gap_adv_active() || phone_count() >= MAX_PHONES)
    return;
  ble_hs_adv_fields fields{};
  fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
  fields.uuids128 = &SERVICE_UUID;
  fields.num_uuids128 = 1;
  fields.uuids128_is_complete = 1;
  ble_gap_adv_set_fields(&fields);

  // The name goes in the scan response so the advert keeps room for the service UUID.
  std::string name = g_gateway->name();
  ble_hs_adv_fields rsp{};
  rsp.name = reinterpret_cast<const uint8_t *>(name.c_str());
  rsp.name_len = static_cast<uint8_t>(std::min<size_t>(name.size(), 29));
  rsp.name_is_complete = name.size() <= 29;
  ble_gap_adv_rsp_set_fields(&rsp);

  ble_gap_adv_params params{};
  params.conn_mode = BLE_GAP_CONN_MODE_UND;
  params.disc_mode = BLE_GAP_DISC_MODE_GEN;
  params.itvl_min = BLE_GAP_ADV_ITVL_MS(200);
  params.itvl_max = BLE_GAP_ADV_ITVL_MS(300);
  int rc = ble_gap_adv_start(g_own_addr_type, nullptr, BLE_HS_FOREVER, &params, on_gap, nullptr);
  if (rc != 0)
    ESP_LOGW(TAG, "advertising failed: %d", rc);
}

int on_disc(ble_gap_event *event, void *) {
  if (event->type == BLE_GAP_EVENT_DISC) {
    const auto &d = event->disc;
    Mac mac;
    std::reverse_copy(d.addr.val, d.addr.val + 6, mac.begin());  // NimBLE keeps addresses little-endian
    detail::note_addr(d.addr);
    g_gateway->on_advert(mac, d.rssi, {d.data, d.length_data});
  } else if (event->type == BLE_GAP_EVENT_DISC_COMPLETE) {
    start_scan();
  }
  return 0;
}


void on_sync() {
  g_synced = true;
  if (g_prune_pending) {
    g_prune_pending = false;
    do_prune(g_keep_pending);
  }
  ble_hs_util_ensure_addr(0);
  ble_hs_id_infer_auto(0, &g_own_addr_type);
  start_advertising();
  start_scan();
}

void on_reset(int reason) { ESP_LOGW(TAG, "NimBLE reset, reason %d", reason); }

void host_task(void *) {
  nimble_port_run();
  nimble_port_freertos_deinit();
}

}  // namespace

void detail::start_scan() {
  if (ble_gap_disc_active())
    ble_gap_disc_cancel();
  ble_gap_disc_params params{};
  // Mostly listening, with gaps so device and phone connections get airtime.
  params.itvl = BLE_GAP_SCAN_ITVL_MS(320);
  params.window = BLE_GAP_SCAN_WIN_MS(240);
  params.passive = 0;  // active: Inkbird sensors send their readings only in the scan response
  params.filter_duplicates = 0;
  int rc = ble_gap_disc(g_own_addr_type, BLE_HS_FOREVER, &params, on_disc, nullptr);
  if (rc != 0)
    ESP_LOGW(TAG, "scan failed: %d", rc);
}

void start(Gateway &gateway) {
  g_gateway = &gateway;
  const esp_timer_create_args_t retry{.callback = pump_all, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK,
                                      .name = "ble_retry", .skip_unhandled_events = true};
  ESP_ERROR_CHECK(esp_timer_create(&retry, &g_retry_timer));
  ESP_ERROR_CHECK(nimble_port_init());
  ble_hs_cfg.sync_cb = on_sync;
  ble_hs_cfg.reset_cb = on_reset;
  // Bonded, encrypted links (LE Secure Connections). The gateway has no screen or keypad, so it's
  // Just Works; who may pair is decided by the gateway (a pairing window, or the setup code).
  ble_hs_cfg.sm_io_cap = BLE_HS_IO_NO_INPUT_OUTPUT;
  ble_hs_cfg.sm_bonding = 1;
  ble_hs_cfg.sm_mitm = 0;
  ble_hs_cfg.sm_sc = 1;
  ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
  ble_store_config_init();
  ble_hs_cfg.store_write_cb = store_write;
  ble_svc_gap_init();
  ble_svc_gatt_init();
  ESP_ERROR_CHECK(ble_gatts_count_cfg(SERVICES));
  ESP_ERROR_CHECK(ble_gatts_add_svcs(SERVICES));
  ble_svc_gap_device_name_set(gateway.name().c_str());
  ble_att_set_preferred_mtu(517);
  nimble_port_freertos_init(host_task);
}

void pair(uint16_t conn) {
  int rc = ble_gap_security_initiate(conn);
  if (rc == 0)
    set_securing(conn, true);
  else if (rc != BLE_HS_EALREADY)
    ESP_LOGW(TAG, "pairing failed to start on %u: %d", conn, rc);
}

void drop(uint16_t conn) { drop_later(conn); }

void prune_bonds(const std::vector<std::string> &keep) {
  if (!g_synced) {
    g_keep_pending = keep;
    g_prune_pending = true;
    return;
  }
  do_prune(keep);
}

void send(uint16_t conn, const std::string &line) {
  {
    std::lock_guard<std::recursive_mutex> lock(g_mutex);
    PhoneLink *p = phone(conn);
    if (!p)
      return;
    // At most 512: the longest attribute value the spec allows (Android drops longer notifications).
    size_t chunk = std::clamp<size_t>(p->mtu - 3, 20, 512);
    std::string data = line + '\n';
    for (size_t i = 0; i < data.size(); i += chunk)
      p->tx.push_back(data.substr(i, chunk));
  }
  pump(conn);
}

}  // namespace openrv::ble
