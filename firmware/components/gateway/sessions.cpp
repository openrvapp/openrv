// Scheduling sessions with connected devices: when to connect, on which link slot, and when to
// give up. What happens during a session is the device's Handler (handlers.cpp).
#include "esp_log.h"
#include "openrv/gateway.h"

namespace openrv {

namespace {
const char *const TAG = "sessions";
/// Connecting includes service discovery; a device out of range or held by another app fails here.
constexpr int64_t CONNECT_TIMEOUT_US = 20LL * 1000 * 1000;
/// Longest a session may stay open, so a device that stops answering is let go.
constexpr int64_t SESSION_TIMEOUT_US = 15LL * 1000 * 1000;
/// After a failed connection, wait before trying a scheduled session again.
constexpr int64_t RETRY_AFTER_FAILURE_US = 60LL * 1000 * 1000;
}  // namespace

/// SessionIo for one session; lives only for the duration of a handler call.
class Gateway::Io : public SessionIo {
 public:
  Io(Gateway &g, Session &s, Device &d) : g_(g), s_(s), d_(d) {}

  void write(Bytes data) override {
    if (s_.state == Session::State::OPEN && !g_.p_.links->write(s_.slot, data))
      ESP_LOGW(TAG, "%s: write failed", d_.id.c_str());
  }

  void updated() override {
    d_.heard_us = now_us();
    g_.evaluate_rules_(d_);
    g_.emit_device_(d_);
  }

  void done() override {
    if (s_.state != Session::State::OPEN)
      return;
    s_.state = Session::State::CLOSING;
    g_.p_.links->close(s_.slot);
  }

  int64_t now_us() override { return g_.p_.now_us(); }

 private:
  Gateway &g_;
  Session &s_;
  Device &d_;
};

void Gateway::add_session_(const Device &d) {
  if (openrv::Handler *h = d.driver->handler()) {
    auto s = std::make_unique<Session>();
    s->device = d.id;
    s->handler = h;
    sessions_.push_back(std::move(s));
  }
}

void Gateway::remove_session_(const std::string &device_id) {
  std::erase_if(sessions_, [&](const auto &s) {
    if (s->device != device_id)
      return false;
    if (s->state != Session::State::IDLE)
      p_.links->close(s->slot);
    return true;
  });
}

Session *Gateway::session_(const std::string &device_id) {
  for (auto &s : sessions_)
    if (s->device == device_id)
      return s.get();
  return nullptr;
}

Session *Gateway::session_for_slot_(int slot) {
  for (auto &s : sessions_)
    if (s->state != Session::State::IDLE && s->slot == slot)
      return s.get();
  return nullptr;
}

void Gateway::run_sessions_(int64_t now) {
  bool opening = false;
  bool used[MAX_LINKS] = {};
  for (auto &s : sessions_) {
    if (s->state == Session::State::OPENING)
      opening = true;
    if (s->state != Session::State::IDLE)
      used[s->slot] = true;
  }

  for (auto &s : sessions_) {
    Device *d = find_(s->device);
    if (!d)
      continue;
    switch (s->state) {
      case Session::State::IDLE: {
        uint32_t interval = s->handler->interval_s(*d);
        bool due = !s->commands.empty() || (interval > 0 && now >= s->next_us);
        // One connection attempt at a time: the radio stops scanning while it connects.
        if (!due || opening)
          break;
        int slot = 0;
        while (slot < MAX_LINKS && used[slot])
          slot++;
        if (slot == MAX_LINKS || !p_.links->open(slot, s->handler->spec(*d)))
          break;  // try again on the next tick
        used[slot] = true;
        opening = true;
        s->state = Session::State::OPENING;
        s->slot = slot;
        s->scheduled = s->commands.empty();
        s->got_data = false;
        s->deadline_us = now + CONNECT_TIMEOUT_US;
        d->link = Link::CONNECTING;
        emit_device_(*d);
        break;
      }
      case Session::State::OPEN: {
        Io io(*this, *s, *d);
        s->handler->poll(*d, io, s->commands);
        [[fallthrough]];
      }
      case Session::State::OPENING:
      case Session::State::CLOSING:
        if (now >= s->deadline_us && s->state != Session::State::IDLE) {
          ESP_LOGW(TAG, "%s: session timed out", d->id.c_str());
          p_.links->close(s->slot);
          s->deadline_us = now + CONNECT_TIMEOUT_US;  // closing; don't ask again every tick
        }
        break;
    }
  }
}

void Gateway::on_link_open(int slot) {
  std::lock_guard lock(mutex_);
  Session *s = session_for_slot_(slot);
  Device *d = s ? find_(s->device) : nullptr;
  if (!d) {
    p_.links->close(slot);
    return;
  }
  s->state = Session::State::OPEN;
  s->deadline_us = p_.now_us() + SESSION_TIMEOUT_US;
  d->link = Link::CONNECTED;
  emit_device_(*d);
  Io io(*this, *s, *d);
  s->handler->begin(*d, io, s->commands, s->scheduled);
}

void Gateway::on_link_data(int slot, Bytes data) {
  std::lock_guard lock(mutex_);
  Session *s = session_for_slot_(slot);
  Device *d = s ? find_(s->device) : nullptr;
  if (!d || s->state != Session::State::OPEN)
    return;
  s->got_data = true;
  Io io(*this, *s, *d);
  s->handler->data(*d, io, data, s->commands);
}

void Gateway::on_link_closed(int slot, bool failed) {
  std::lock_guard lock(mutex_);
  Session *s = session_for_slot_(slot);
  Device *d = s ? find_(s->device) : nullptr;
  if (s && d)
    end_session_(*s, *d, failed || !s->got_data);
}

void Gateway::end_session_(Session &s, Device &d, bool failed) {
  int64_t now = p_.now_us();
  if (failed && !s.commands.empty())
    ESP_LOGW(TAG, "%s: unreachable, dropping %u command(s)", d.id.c_str(), static_cast<unsigned>(s.commands.size()));
  if (failed)
    s.commands.clear();  // a command that can't be delivered now shouldn't surprise anyone later
  s.state = Session::State::IDLE;
  s.slot = -1;
  uint32_t interval = s.handler->interval_s(d);
  s.next_us = now + static_cast<int64_t>(interval) * 1000000 + (failed ? RETRY_AFTER_FAILURE_US : 0);
  d.link = failed ? Link::UNREACHABLE : Link::IDLE;
  d.busy = !s.commands.empty();
  emit_device_(d);
}

}  // namespace openrv
