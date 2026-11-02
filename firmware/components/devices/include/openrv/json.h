#pragma once

#include <memory>
#include <string>
#include <string_view>

#include "cJSON.h"

namespace openrv {

struct JsonDeleter {
  void operator()(cJSON *j) const { cJSON_Delete(j); }
};
/// Owns a cJSON tree.
using Json = std::unique_ptr<cJSON, JsonDeleter>;

inline Json json_object() { return Json(cJSON_CreateObject()); }
inline Json json_parse(std::string_view text) { return Json(cJSON_ParseWithLength(text.data(), text.size())); }

/// Compact JSON text, no trailing newline.
inline std::string json_print(const cJSON *j) {
  char *s = cJSON_PrintUnformatted(j);
  std::string out = s ? s : "null";
  cJSON_free(s);
  return out;
}

inline const char *json_string(const cJSON *obj, const char *key) {
  const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
  return cJSON_IsString(v) ? v->valuestring : nullptr;
}

/// Adds a number, or null when the value is missing.
template <typename T> void json_number_or_null(cJSON *obj, const char *key, const T *v) {
  if (v)
    cJSON_AddNumberToObject(obj, key, static_cast<double>(*v));
  else
    cJSON_AddNullToObject(obj, key);
}

}  // namespace openrv
